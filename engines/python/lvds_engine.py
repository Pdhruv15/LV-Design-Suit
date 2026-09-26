"""LV Design Studio — external calculation engines (OpenDSS, pandapower).

Started by the Electron main process. Reads one JSON request on stdin and
writes one JSON response on stdout:

  request:  {"engine": "probe"}
            {"engine": "opendss",    "project": {...}, "dss": "<script>"}
            {"engine": "pandapower", "project": {...}}
  response: StudyResults (see src/engines/types.ts), a probe result, or
            {"error": "..."}

Only JSON goes to stdout; library warnings go to stderr.
"""

import json
import math
import sys
import warnings

MV_KV = 11.0
STIFF_SOURCE_MVA = 100000.0
DEFAULT_TRANSFORMER_XR = 5.0

# Must match src/calc/cableTable.ts and the 1.2 operating-temperature factor
# in src/calc/electrical.ts, so every engine sees the same cable data.
CABLES = {
    1.5: (12.1, 0.1, 26), 2.5: (7.41, 0.1, 36), 4: (4.61, 0.09, 47), 6: (3.08, 0.09, 60),
    10: (1.83, 0.09, 80), 16: (1.15, 0.085, 105), 25: (0.727, 0.085, 138), 35: (0.524, 0.08, 168),
    50: (0.387, 0.08, 200), 70: (0.268, 0.08, 253), 95: (0.193, 0.075, 306), 120: (0.153, 0.075, 354),
    150: (0.124, 0.075, 393), 185: (0.0991, 0.07, 448), 240: (0.0754, 0.07, 528), 300: (0.0601, 0.07, 603),
}
R_OPERATING_FACTOR = 1.2


def dss_name(s):
    return "".join(c if c.isalnum() or c in "_-" else "_" for c in s)


def root_boards(project):
    return [b for b in project["boards"] if not b.get("upstreamId")]


def supply_board_of(project, board_id):
    """Walks up to the main (root) board a board is fed from."""
    boards = {b["id"]: b for b in project["boards"]}
    seen = set()
    while board_id in boards and boards[board_id].get("upstreamId") and board_id not in seen:
        seen.add(board_id)
        board_id = boards[board_id]["upstreamId"]
    return board_id


def probe():
    out = {}
    try:
        import opendssdirect as dss
        out["opendss"] = {"available": True, "version": dss.Basic.Version().split(" revision")[0]}
    except Exception as e:  # noqa: BLE001 — report any import failure
        out["opendss"] = {"available": False, "error": str(e)}
    try:
        import pandapower
        out["pandapower"] = {"available": True, "version": pandapower.__version__}
    except Exception as e:  # noqa: BLE001
        out["pandapower"] = {"available": False, "error": str(e)}
    return {"python": sys.version.split()[0], "engines": out}


# --------------------------------------------------------------------------
# OpenDSS — runs the script produced by src/engines/opendss/exportDss.ts
# --------------------------------------------------------------------------

def run_opendss(project, script):
    import opendssdirect as dss

    def cmd(line):
        dss.Text.Command(line)
        err = dss.Error.Description() if hasattr(dss, "Error") else ""
        if err:
            raise RuntimeError(f"OpenDSS: {err} (in: {line})")

    # Build the circuit and solve the load flow; skip the script's own
    # Show/fault-study commands, which are for interactive use.
    for raw in script.splitlines():
        line = raw.strip()
        low = line.lower()
        if not line or line.startswith("!") or low.startswith("show") or "mode=faultstudy" in low:
            continue
        cmd(line)
    if not dss.Solution.Converged():
        raise RuntimeError("OpenDSS load flow did not converge.")

    def bus_vpu(bus, single_phase):
        dss.Circuit.SetActiveBus(bus)
        mags = dss.Bus.puVmagAngle()[0::2]
        return mags[0] if single_phase else sum(mags) / len(mags)

    results, messages = {}, []
    feeders = project["feeders"]

    # Load flow: current and source-to-end voltage drop per feeder.
    for f in feeders:
        single = f["cores"] == 2
        dss.Circuit.SetActiveElement(f"Line.{dss_name(f['id'])}")
        nph = dss.CktElement.NumPhases()
        mags = dss.CktElement.CurrentsMagAng()[0::2][:nph]
        end_bus = f"bb_{dss_name(f['feedsBoardId'])}" if f.get("feedsBoardId") else f"ld_{dss_name(f['id'])}"
        main_bus = f"bb_{dss_name(supply_board_of(project, f['boardId']))}"
        vd = (bus_vpu(main_bus, single) - bus_vpu(end_bus, single)) * 100
        results[f["id"]] = {"ib": max(mags), "vdTotalPct": vd, "_end": end_bus}

    # Busbar voltage of every board, as % of nominal (includes the
    # transformer's own voltage drop, unlike the built-in estimate).
    boards = {}
    for b in project["boards"]:
        try:
            boards[b["id"]] = {"voltagePct": bus_vpu(f"bb_{dss_name(b['id'])}", False) * 100}
        except Exception:  # noqa: BLE001 — board not energised / not in the model
            messages.append(f"No load-flow voltage for board {b['id']}.")

    # Fault study: disable loads/generation (IEC 60909 neglects them) and
    # read each bus's positive-sequence short-circuit impedance.
    cmd("BatchEdit Load..* enabled=no")
    cmd("BatchEdit Generator..* enabled=no")
    cmd("Solve mode=faultstudy")

    def ik3_ka(bus):
        dss.Circuit.SetActiveBus(bus)
        r, x = dss.Bus.Zsc1()[:2]
        return dss.Bus.kVBase() / math.hypot(r, x)  # kV (L-N) / ohm = kA

    for f in feeders:
        res = results[f["id"]]
        res["breakerFaultKA"] = ik3_ka(f"bb_{dss_name(f['boardId'])}")
        res["endFaultKA"] = ik3_ka(res.pop("_end"))
    for bid, entry in boards.items():
        entry["faultKA"] = ik3_ka(f"bb_{dss_name(bid)}")

    messages.append(f"OpenDSS {dss.Basic.Version().split(' revision')[0]} - load flow + fault study (c = 1, loads excluded from faults).")
    return {"engineId": "opendss", "feeders": results, "boards": boards, "messages": messages}


# --------------------------------------------------------------------------
# pandapower - load flow + IEC 60909 short circuit
# --------------------------------------------------------------------------

def run_pandapower(project):
    import pandapower as pp
    import pandapower.shortcircuit as sc

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
        r20, x, amps = CABLES[f["cableCsaMm2"]]
        end = bus[f["feedsBoardId"]] if f.get("feedsBoardId") else pp.create_bus(net, vn_kv=kv, name=f"ld_{f['id']}")
        end_bus_of[f["id"]] = end
        line_of[f["id"]] = pp.create_line_from_parameters(
            net, from_bus=bus[f["boardId"]], to_bus=end, length_km=f["lengthM"] / 1000.0,
            r_ohm_per_km=r20 * R_OPERATING_FACTOR, x_ohm_per_km=x, c_nf_per_km=0.0,
            max_i_ka=amps / 1000.0, name=f["id"])
        if f["cores"] == 2:
            single_phase.append(f["id"])
        if f.get("feedsBoardId"):
            continue
        p = f["loadKw"] * f["demandFactor"] / 1000.0
        q = p * math.tan(math.acos(max(min(f["powerFactor"], 1.0), 1e-6)))
        if f.get("generation"):
            pp.create_sgen(net, end, p_mw=p, q_mvar=q, name=f["id"])
        else:
            pp.create_load(net, end, p_mw=p, q_mvar=q, name=f["id"])

    pp.runpp(net)

    boards = {bid: {"voltagePct": float(net.res_bus.at[b, "vm_pu"]) * 100.0} for bid, b in bus.items()
              if not math.isnan(net.res_bus.at[b, "vm_pu"])}
    results = {}
    for f in project["feeders"]:
        if f["id"] not in line_of:
            continue
        main = bus[supply_board_of(project, f["boardId"])]
        entry = {}
        if f["id"] not in single_phase:
            entry["ib"] = float(net.res_line.at[line_of[f["id"]], "i_from_ka"]) * 1000.0
            entry["vdTotalPct"] = float(net.res_bus.at[main, "vm_pu"] - net.res_bus.at[end_bus_of[f["id"]], "vm_pu"]) * 100.0
        results[f["id"]] = entry
    if single_phase:
        messages.append("pandapower models a balanced 3-phase network, so current, voltage drop and end fault are "
                        f"not reported for single-phase (2-core) circuits: {', '.join(single_phase)}.")

    # IEC 60909 maximum 3-phase short circuit. Generation is excluded so the
    # result is comparable with the other engines.
    net.sgen["in_service"] = False
    sc.calc_sc(net, fault="3ph", case="max", lv_tol_percent=10)
    for f in project["feeders"]:
        if f["id"] in results:
            results[f["id"]]["breakerFaultKA"] = float(net.res_bus_sc.at[bus[f["boardId"]], "ikss_ka"])
            if f["id"] not in single_phase:  # a 3-phase fault at a single-phase end is meaningless
                results[f["id"]]["endFaultKA"] = float(net.res_bus_sc.at[end_bus_of[f["id"]], "ikss_ka"])

    for bid, entry in boards.items():
        entry["faultKA"] = float(net.res_bus_sc.at[bus[bid], "ikss_ka"])
    messages.append(f"pandapower {pp.__version__} - Newton-Raphson load flow; IEC 60909 max short circuit "
                    "(cmax = 1.10, transformer correction KT applied, PV excluded).")
    return {"engineId": "pandapower", "feeders": results, "boards": boards, "messages": messages}


def main():
    warnings.simplefilter("ignore")
    try:
        req = json.loads(sys.stdin.read())
        engine = req.get("engine")
        if engine == "probe":
            res = probe()
        elif engine == "opendss":
            res = run_opendss(req["project"], req["dss"])
        elif engine == "pandapower":
            res = run_pandapower(req["project"])
        else:
            res = {"error": f"Unknown engine: {engine}"}
    except Exception as e:  # noqa: BLE001 — every failure goes back to the app as JSON
        res = {"error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(json.dumps(res))


if __name__ == "__main__":
    main()
