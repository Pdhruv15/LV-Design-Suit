"""LV Design Studio — external calculation engines (OpenDSS, pandapower).

Started by the Electron main process. Reads one JSON request on stdin and
writes one JSON response on stdout:

  request:  {"engine": "probe"}
            {"engine": "opendss",    "project": {...}, "dss": "<script>"}
            {"engine": "pandapower", "project": {...}}
  response: StudyResults (see src/engines/types.ts), a probe result, or
            {"error": "..."} with a message the engineer can act on.

Only JSON goes to stdout; anything the libraries print goes to stderr.
"""

import json
import math
import os
import sys
import warnings

MV_KV = 11.0
STIFF_SOURCE_MVA = 100000.0
DEFAULT_TRANSFORMER_XR = 5.0

# Fallback only: the app sends the cable table it is using (Cables.xlsx or
# its reference values) and the resistance factor for the chosen conductor
# temperature with every request, so both engines see the same data.
CABLES = {
    1.5: (12.1, 0.1, 26), 2.5: (7.41, 0.1, 36), 4: (4.61, 0.09, 47), 6: (3.08, 0.09, 60),
    10: (1.83, 0.09, 80), 16: (1.15, 0.085, 105), 25: (0.727, 0.085, 138), 35: (0.524, 0.08, 168),
    50: (0.387, 0.08, 200), 70: (0.268, 0.08, 253), 95: (0.193, 0.075, 306), 120: (0.153, 0.075, 354),
    150: (0.124, 0.075, 393), 185: (0.0991, 0.07, 448), 240: (0.0754, 0.07, 528), 300: (0.0601, 0.07, 603),
}
R_OPERATING_FACTOR = 1.2
MAX_ITERATIONS = 100

REQUIREMENTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")
INSTALL_HINT = f"pip install -r \"{REQUIREMENTS}\""


class EngineError(Exception):
    """A failure explained in the engineer's terms; sent to the app as-is."""


def tested_versions():
    """Exact pins from requirements.txt (package -> version); empty when the file is missing."""
    pins = {}
    try:
        with open(REQUIREMENTS, encoding="utf-8") as fh:
            for line in fh:
                name, sep, version = line.split("#", 1)[0].strip().partition("==")
                if sep:
                    pins[name.strip().lower()] = version.strip()
    except OSError:
        pass
    return pins


def need(module, package):
    """Imports an engine package, or explains how to install it."""
    try:
        return __import__(module, fromlist=["_"])
    except ImportError as e:
        raise EngineError(f"{package} is not installed for this Python ({sys.executable}). "
                          f"Install the tested versions with: {INSTALL_HINT}") from e


def dss_name(s):
    return "".join(c if c.isalnum() or c in "_-" else "_" for c in s)


def root_boards(project):
    return [b for b in project["boards"] if not b.get("upstreamId")]


def check_project(project):
    """Rejects a project the engines cannot model, with every reason found."""
    problems = []
    if not project.get("voltageV") or project["voltageV"] <= 0:
        problems.append("The project voltage must be above 0 V.")
    if not project.get("frequencyHz") or project["frequencyHz"] <= 0:
        problems.append("The project frequency must be above 0 Hz.")
    boards = project.get("boards") or []
    ids = [b["id"] for b in boards]
    known = set(ids)
    if not boards:
        problems.append("The project has no boards.")
    for bid in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f"Board id {bid} is used by more than one board.")
    up = {b["id"]: b.get("upstreamId") for b in boards}
    for b in boards:
        if b.get("upstreamId") and b["upstreamId"] not in known:
            problems.append(f"Board {b['id']} is fed from {b['upstreamId']}, which is not a board in the project.")
        seen, at = set(), b["id"]
        while up.get(at) and at not in seen:
            seen.add(at)
            at = up[at]
        if at in seen:
            problems.append(f"Board {b['id']} is in a loop of upstream boards ({' -> '.join(sorted(seen))}).")
    if boards and not any(b.get("sourceKva") and b.get("sourceImpedancePct") for b in root_boards(project)):
        problems.append("No main board has transformer data (kVA and %Z), so nothing in the network is energised.")
    for f in project.get("feeders") or []:
        name = f"Feeder {f['id']}"
        if f.get("feedsBoardId") and f["feedsBoardId"] not in known:
            problems.append(f"{name} feeds board {f['feedsBoardId']}, which is not a board in the project.")
        if f.get("feedsBoardId") and f["feedsBoardId"] == f["boardId"]:
            problems.append(f"{name} feeds the board it is on ({f['boardId']}).")
        if not f.get("lengthM") or f["lengthM"] <= 0:
            problems.append(f"{name} has a cable length of {f.get('lengthM', 0)} m; it must be above 0 m.")
        if not f.get("cableCsaMm2") or f["cableCsaMm2"] <= 0:
            problems.append(f"{name} has no cable size.")
        if not f.get("feedsBoardId") and not f.get("kvar"):
            if f.get("loadKw", 0) < 0 or f.get("demandFactor", 0) < 0:
                problems.append(f"{name} has a negative load or demand factor.")
            if f.get("loadKw") and not 0 < f.get("powerFactor", 0) <= 1:
                problems.append(f"{name} has a power factor of {f.get('powerFactor')}; it must be above 0 and at most 1.")
    if problems:
        shown = problems[:6]
        more = f" (and {len(problems) - 6} more)" if len(problems) > 6 else ""
        raise EngineError("The network cannot be studied: " + " ".join(shown) + more)


def overload_hints(project, cables):
    """Transformers and cables loaded far beyond what a load flow can sensibly solve."""
    demand = {}
    for f in project["feeders"]:
        if f.get("feedsBoardId") or f.get("generation") or f.get("kvar"):
            continue
        p = f["loadKw"] * f["demandFactor"]
        q = p * math.tan(math.acos(max(min(f["powerFactor"], 1.0), 1e-6)))
        at = demand.setdefault(supply_board_of(project, f["boardId"]), [0.0, 0.0])
        at[0] += p
        at[1] += q
    hints = []
    for b in root_boards(project):
        p, q = demand.get(b["id"], (0.0, 0.0))
        kva = math.hypot(p, q)
        if b.get("sourceKva") and kva > 1.5 * b["sourceKva"]:
            hints.append(f"main board {b['id']} has {kva:.0f} kVA of demand on a {b['sourceKva']:.0f} kVA transformer")
    kv = project["voltageV"] / 1000.0
    for f in project["feeders"]:
        spec = cables.get(float(f.get("cableCsaMm2") or 0))
        if f.get("feedsBoardId") or f.get("generation") or not spec or not f.get("loadKw"):
            continue
        runs = max(1, int(f.get("parallel") or 1))
        single = f["cores"] == 2
        pf = max(min(f["powerFactor"], 1.0), 1e-6)
        amps = f["loadKw"] * f["demandFactor"] / ((kv / math.sqrt(3) if single else kv * math.sqrt(3)) * pf)
        z = (spec[0] * R_OPERATING_FACTOR * pf + spec[1] * math.sin(math.acos(pf))) * f["lengthM"] / 1000.0 / runs
        vd = amps * z * (2 if single else math.sqrt(3)) / (project["voltageV"] / (math.sqrt(3) if single else 1)) * 100
        if vd > 25:
            hints.append(f"feeder {f['id']} would drop about {vd:.0f} % on its {f['cableCsaMm2']} mm2 cable")
    return hints


def no_convergence(engine, project, cables):
    """Why a load flow did not converge, with the figures that point at the cause."""
    hints = overload_hints(project, cables)
    cause = ("Likely cause: " + "; ".join(hints[:4]) + ".") if hints else \
        "Check for a very small or very long cable on a large load, or a transformer far smaller than its demand."
    return EngineError(f"{engine} load flow did not converge after {MAX_ITERATIONS} iterations, so it has no results. {cause}")


def finite(x):
    """The value as a float, or None when the engine left it undefined (an unenergised bus)."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def supply_board_of(project, board_id):
    """Walks up to the main (root) board a board is fed from."""
    boards = {b["id"]: b for b in project["boards"]}
    seen = set()
    while board_id in boards and boards[board_id].get("upstreamId") and board_id not in seen:
        seen.add(board_id)
        board_id = boards[board_id]["upstreamId"]
    return board_id


def probe():
    pins = tested_versions()
    out = {}
    for engine, package, version_of in (
            ("opendss", "opendssdirect.py", lambda: __import__("opendssdirect").__version__),
            ("pandapower", "pandapower", lambda: __import__("pandapower").__version__)):
        entry = {"available": False, "tested": pins.get(package)}
        try:
            entry.update(available=True, version=version_of())
        except Exception as e:  # noqa: BLE001 — report any import failure
            entry["error"] = str(e)
        if entry["available"] and entry["tested"] and entry["version"] != entry["tested"]:
            entry["note"] = (f"{package} {entry['version']} is installed; results were validated with {entry['tested']}. "
                             f"Install the tested version with: {INSTALL_HINT}")
        out[engine] = {k: v for k, v in entry.items() if v is not None}
    return {"python": sys.version.split()[0], "engines": out}


# --------------------------------------------------------------------------
# OpenDSS — runs the script produced by src/engines/opendss/exportDss.ts
# --------------------------------------------------------------------------

# The only OpenDSS commands the app's own script uses (src/engines/opendss/exportDss.ts). Anything else —
# Redirect / Compile (read files), Export / Save (write files), DOScmd (runs a shell command), CD … — is
# refused, so a script can only build and solve a circuit.
ALLOWED_DSS = {"clear", "new", "set", "calcvoltagebases", "solve"}
ALLOWED_DSS_SET = {"defaultbasefrequency", "voltagebases", "mode"}


def check_dss_line(line):
    """Raise ValueError when a script line is not one the app generates."""
    words = line.split(None, 1)
    verb = words[0].lower() if words else ""
    if verb not in ALLOWED_DSS:
        raise ValueError(f"OpenDSS command not allowed: {words[0] if words else repr(line)}")
    if verb == "set":
        key = (words[1] if len(words) > 1 else "").split("=", 1)[0].strip().lower()
        if key not in ALLOWED_DSS_SET:
            raise ValueError(f"OpenDSS option not allowed: Set {key}")


def run_opendss(project, script, cables=None):
    check_project(project)
    table = {float(c[0]): (c[1], c[2], c[3]) for c in cables} if cables else CABLES
    dss = need("opendssdirect", "opendssdirect.py")

    def cmd(line):
        try:
            dss.Text.Command(line)
            err = dss.Error.Description() if hasattr(dss, "Error") else ""
        except Exception as e:  # noqa: BLE001 — DSS C-API raises its own exception type
            err = str(e)
        if err:
            raise EngineError(f"OpenDSS could not run the network script: {err} (in: {line})")

    # Build the circuit and solve the load flow; skip the script's own
    # Show/fault-study commands, which are for interactive use.
    for raw in script.splitlines():
        line = raw.strip()
        low = line.lower()
        if not line or line.startswith("!") or low.startswith("show") or "mode=faultstudy" in low:
            continue
        check_dss_line(line)
        cmd(line)
    results, messages = {}, []
    if not dss.Solution.Converged():
        # The script solves with OpenDSS's default 15 iterations; a heavily loaded network may need more.
        cmd(f"Set maxiterations={MAX_ITERATIONS}")
        cmd("Solve")
        if not dss.Solution.Converged():
            raise no_convergence("OpenDSS", project, table)
        messages.append(f"OpenDSS needed {dss.Solution.Iterations()} load-flow iterations: the network is heavily loaded.")

    def bus_vpu(bus, single_phase):
        """Per-unit voltage at a bus, or None when the bus is missing or not energised."""
        if dss.Circuit.SetActiveBus(bus) < 0:
            return None
        mags = dss.Bus.puVmagAngle()[0::2]
        if not mags:
            return None
        v = mags[0] if single_phase else sum(mags) / len(mags)
        return v if v > 1e-6 else None

    feeders = [f for f in project["feeders"] if f["boardId"] in {b["id"] for b in project["boards"]}]
    dead = []

    # Load flow: current and source-to-end voltage drop per feeder.
    for f in feeders:
        single = f["cores"] == 2
        end_bus = f"bb_{dss_name(f['feedsBoardId'])}" if f.get("feedsBoardId") else f"ld_{dss_name(f['id'])}"
        main_v = bus_vpu(f"bb_{dss_name(supply_board_of(project, f['boardId']))}", single)
        end_v = bus_vpu(end_bus, single)
        if main_v is None or end_v is None:
            dead.append(f["id"])
            continue
        dss.Circuit.SetActiveElement(f"Line.{dss_name(f['id'])}")
        nph = dss.CktElement.NumPhases()
        mags = dss.CktElement.CurrentsMagAng()[0::2][:nph]
        results[f["id"]] = {"ib": max(mags), "vdTotalPct": (main_v - end_v) * 100, "_end": end_bus}
    if dead:
        messages.append(f"Not energised, so no results: {', '.join(dead)}.")

    # Below Vminpu (0.95) OpenDSS turns constant-power loads into constant impedance, so it always
    # "converges" — say so rather than show the lower currents as if they were the design figures.
    low = [f["id"] for f in feeders if not f.get("feedsBoardId") and not f.get("generation") and not f.get("kvar")
           and (bus_vpu(f"ld_{dss_name(f['id'])}", f["cores"] == 2) or 1.0) < 0.95]
    if low:
        hints = overload_hints(project, table)
        messages.append(f"Load voltage is below 95 % at {', '.join(low[:8])}{' …' if len(low) > 8 else ''}: OpenDSS models "
                        "those loads as constant impedance there, so their current and voltage drop are lower than at "
                        "full power." + (f" Likely cause: {'; '.join(hints[:4])}." if hints else ""))

    # Busbar voltage of every board, as % of nominal (includes the
    # transformer's own voltage drop, unlike the built-in estimate).
    boards = {}
    for b in project["boards"]:
        v = bus_vpu(f"bb_{dss_name(b['id'])}", False)
        if v is None:
            messages.append(f"No load-flow voltage for board {b['id']} (not energised).")
        else:
            boards[b["id"]] = {"voltagePct": v * 100}

    # Fault study: disable loads, generation and capacitors (IEC 60909 neglects them) and
    # read each bus's positive-sequence short-circuit impedance.
    cmd("BatchEdit Load..* enabled=no")
    cmd("BatchEdit Generator..* enabled=no")
    cmd("BatchEdit Capacitor..* enabled=no")
    cmd("Solve mode=faultstudy")

    def ik3_ka(bus):
        if dss.Circuit.SetActiveBus(bus) < 0:
            return None
        r, x = dss.Bus.Zsc1()[:2]
        z = math.hypot(r, x)
        return finite(dss.Bus.kVBase() / z) if z > 0 else None  # kV (L-N) / ohm = kA

    def put(entry, key, value):
        if value is not None:
            entry[key] = value

    for f in feeders:
        res = results.get(f["id"])
        if res is not None:
            put(res, "breakerFaultKA", ik3_ka(f"bb_{dss_name(f['boardId'])}"))
            put(res, "endFaultKA", ik3_ka(res.pop("_end")))
    for bid, entry in boards.items():
        put(entry, "faultKA", ik3_ka(f"bb_{dss_name(bid)}"))

    messages.append(f"OpenDSS {dss.Basic.Version().split(' revision')[0]} - load flow + fault study (c = 1, loads excluded from faults).")
    return {"engineId": "opendss", "feeders": results, "boards": boards, "messages": messages}


# --------------------------------------------------------------------------
# pandapower - load flow + IEC 60909 short circuit
# --------------------------------------------------------------------------

def run_pandapower(project, cables=None, r_factor=None):
    check_project(project)
    table = {float(c[0]): (c[1], c[2], c[3]) for c in cables} if cables else CABLES
    rf = r_factor if r_factor else R_OPERATING_FACTOR
    pp = need("pandapower", "pandapower")
    sc = need("pandapower.shortcircuit", "pandapower")

    kv = project["voltageV"] / 1000.0
    net = pp.create_empty_network(f_hz=project["frequencyHz"])
    messages = []

    mv = pp.create_bus(net, vn_kv=MV_KV, name="sourcebus")
    pp.create_ext_grid(net, mv, vm_pu=1.0, s_sc_max_mva=STIFF_SOURCE_MVA, rx_max=0.1,
                       s_sc_min_mva=STIFF_SOURCE_MVA, rx_min=0.1)

    bus = {b["id"]: pp.create_bus(net, vn_kv=kv, name=b["id"]) for b in project["boards"]}

    for b in root_boards(project):
        if not b.get("sourceKva") or not b.get("sourceImpedancePct"):
            messages.append(f"Main board {b['id']} has no transformer data and is not energised.")
            continue
        xr = b.get("sourceXr") or DEFAULT_TRANSFORMER_XR
        z = b["sourceImpedancePct"]
        pp.create_transformer_from_parameters(
            net, hv_bus=mv, lv_bus=bus[b["id"]], sn_mva=b["sourceKva"] / 1000.0,
            vn_hv_kv=MV_KV, vn_lv_kv=kv, vk_percent=z, vkr_percent=z / math.sqrt(1 + xr * xr),
            pfe_kw=0.0, i0_percent=0.0, vector_group="Dyn", name=f"TX_{b['id']}")

    single_phase = []
    line_of, end_bus_of = {}, {}
    for f in project["feeders"]:
        if f["boardId"] not in bus:
            messages.append(f"Feeder {f['id']} is on unknown board {f['boardId']} and was skipped.")
            continue
        spec = table.get(float(f["cableCsaMm2"]))
        if spec is None:
            messages.append(f"Feeder {f['id']}: no cable data for {f['cableCsaMm2']} mm2 and was skipped.")
            continue
        r20, x, amps = spec
        end = bus[f["feedsBoardId"]] if f.get("feedsBoardId") else pp.create_bus(net, vn_kv=kv, name=f"ld_{f['id']}")
        end_bus_of[f["id"]] = end
        line_of[f["id"]] = pp.create_line_from_parameters(
            net, from_bus=bus[f["boardId"]], to_bus=end, length_km=f["lengthM"] / 1000.0,
            r_ohm_per_km=r20 * rf, x_ohm_per_km=x, c_nf_per_km=0.0,
            max_i_ka=amps / 1000.0, parallel=max(1, int(f.get("parallel") or 1)), name=f["id"])
        if f["cores"] == 2:
            single_phase.append(f["id"])
        if f.get("feedsBoardId"):
            continue
        p = f["loadKw"] * f["demandFactor"] / 1000.0
        q = p * math.tan(math.acos(max(min(f["powerFactor"], 1.0), 1e-6)))
        if f.get("kvar"):  # capacitor bank: reactive power only, leading
            p, q = 0.0, -f["kvar"] / 1000.0
        if f.get("generation"):
            pp.create_sgen(net, end, p_mw=p, q_mvar=q, name=f["id"])
        else:
            pp.create_load(net, end, p_mw=p, q_mvar=q, name=f["id"])

    try:
        pp.runpp(net, max_iteration=MAX_ITERATIONS)
    except pp.LoadflowNotConverged:
        raise no_convergence("pandapower", project, table) from None

    vm = {b: finite(net.res_bus.at[b, "vm_pu"]) for b in net.bus.index}
    boards = {}
    for bid, b in bus.items():
        if vm[b] is None:
            messages.append(f"No load-flow voltage for board {bid} (not energised).")
        else:
            boards[bid] = {"voltagePct": vm[b] * 100.0}
    results, dead = {}, []
    for f in project["feeders"]:
        if f["id"] not in line_of:
            continue
        main, end = vm[bus[supply_board_of(project, f["boardId"])]], vm[end_bus_of[f["id"]]]
        if main is None or end is None:
            dead.append(f["id"])
            continue
        entry = {}
        if f["id"] not in single_phase:
            entry["ib"] = float(net.res_line.at[line_of[f["id"]], "i_from_ka"]) * 1000.0
            entry["vdTotalPct"] = (main - end) * 100.0
        results[f["id"]] = entry
    if dead:
        messages.append(f"Not energised, so no results: {', '.join(dead)}.")
    if single_phase:
        messages.append("pandapower models a balanced 3-phase network, so current, voltage drop and end fault are "
                        f"not reported for single-phase (2-core) circuits: {', '.join(single_phase)}.")

    # IEC 60909 maximum 3-phase short circuit. Generation is excluded so the
    # result is comparable with the other engines.
    net.sgen["in_service"] = False
    try:
        sc.calc_sc(net, fault="3ph", case="max", lv_tol_percent=10)
    except Exception as e:  # noqa: BLE001 — keep the load-flow results and say why faults are missing
        messages.append(f"pandapower short-circuit study failed, so no fault currents are shown: {type(e).__name__}: {e}")
        return {"engineId": "pandapower", "feeders": results, "boards": boards, "messages": messages}

    def ik(b):
        return finite(net.res_bus_sc.at[b, "ikss_ka"])

    for f in project["feeders"]:
        if f["id"] in results:
            entry = results[f["id"]]
            at_board = ik(bus[f["boardId"]])
            if at_board is not None:
                entry["breakerFaultKA"] = at_board
            at_end = ik(end_bus_of[f["id"]])
            if f["id"] not in single_phase and at_end is not None:  # a 3-phase fault at a single-phase end is meaningless
                entry["endFaultKA"] = at_end

    for bid, entry in boards.items():
        if ik(bus[bid]) is not None:
            entry["faultKA"] = ik(bus[bid])
    messages.append(f"pandapower {pp.__version__} - Newton-Raphson load flow; IEC 60909 max short circuit "
                    "(cmax = 1.10, transformer correction KT applied, PV excluded).")
    return {"engineId": "pandapower", "feeders": results, "boards": boards, "messages": messages}


def main():
    warnings.simplefilter("ignore")
    out = sys.stdout
    sys.stdout = sys.stderr  # a library that prints must not corrupt the JSON answer
    engine = "engine"
    try:
        req = json.loads(sys.stdin.read())
        engine = req.get("engine")
        if engine == "probe":
            res = probe()
        elif engine == "opendss":
            res = run_opendss(req["project"], req["dss"], req.get("cables"))
        elif engine == "pandapower":
            res = run_pandapower(req["project"], req.get("cables"), req.get("rFactor"))
        else:
            res = {"error": f"Unknown engine: {engine}"}
        text = json.dumps(res, allow_nan=False)  # NaN / infinity is not JSON: the app could not read it
    except EngineError as e:
        text = json.dumps({"error": str(e)})
    except Exception as e:  # noqa: BLE001 — every failure goes back to the app as JSON
        text = json.dumps({"error": f"The {engine} run failed unexpectedly ({type(e).__name__}: {e}). Check the "
                                    "network data; if it looks right, report this with the project file."})
    finally:
        sys.stdout = out
    out.write(text)


if __name__ == "__main__":
    main()
