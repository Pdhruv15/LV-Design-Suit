# LV Design Studio — summary of the LV links in this drawing (runs inside OpenCADStudio).
# Open CAD Studio: Python Scripting → Run Script… → choose this file (or type: PY_RUN <path>/lv_summary.py).
# Lists every cable route, cable tray and board linked by LV Design Studio (extended data "LVDS"), with the measured
# plan length, on the command line, and adds the same as a table at the lower left of the linked objects.
# Running it again replaces the table it made before. 2D plan only. Lengths assume the drawing is in millimetres
# (set UNITS_TO_M below for other units).

UNITS_TO_M = 0.001
APP = "LVDS"
MARK = "summary-table"  # extended data on the table this script makes, so a new run can replace it
PI = 3.141592653589793


def _atan(x):
    # The script sandbox has no math module: arctangent by range reduction and its series.
    if x < 0:
        return -_atan(-x)
    if x > 1:
        return PI / 2 - _atan(1 / x)
    x = x / (1 + (1 + x * x) ** 0.5)  # atan(x) = 2 atan(x / (1 + sqrt(1 + x²))), so |x| <= 0.42
    total, term, n = 0.0, x, 0
    while n < 60:
        total += term / (2 * n + 1) * (-1) ** n
        term *= x * x
        n += 1
    return 2 * total


def _sin(t):
    while t > PI:
        t -= 2 * PI
    while t < -PI:
        t += 2 * PI
    total, term, n = 0.0, t, 1
    while n < 40:
        total += term
        term *= -t * t / ((2 * n) * (2 * n + 1))
        n += 1
    return total


def _xy(p):
    return (p["x"], p["y"]) if isinstance(p, dict) and "x" in p else None


def _segment(a, b, bulge):
    chord = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
    if not bulge or not chord:
        return chord
    theta = 4 * _atan(abs(bulge))
    return chord / (2 * _sin(theta / 2)) * theta


def length(e):
    """Plan length of a line, arc or polyline (arc segments included), in drawing units; 0 for other objects."""
    kind = e.get("kind", "")
    if kind == "Line":
        a, b = _xy(e.get("start")), _xy(e.get("end"))
        return ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5 if a and b else 0.0
    if kind == "Arc" and "radius" in e:
        sweep = (e.get("end_angle", 0) - e.get("start_angle", 0)) % (2 * PI) or 2 * PI
        return e["radius"] * sweep
    verts = e.get("vertices")
    if "olyline" in kind and verts:
        pts = [(_xy(v.get("location", v)), v.get("bulge", 0) or 0) for v in verts]
        pts = [p for p in pts if p[0]]
        total = sum(_segment(pts[i][0], pts[i + 1][0], pts[i][1]) for i in range(len(pts) - 1))
        if e.get("closed") and len(pts) > 2:
            total += _segment(pts[-1][0], pts[0][0], pts[-1][1])
        return total
    return 0.0


def first_point(e):
    for key in ("start", "center", "insertion_point", "position"):
        if _xy(e.get(key)):
            return _xy(e[key])
    verts = e.get("vertices")
    if verts:
        return _xy(verts[0].get("location", verts[0]))
    return None


# The table from an earlier run is replaced.
old = 0
for h in ocs.entity_handles():
    rec = ocs.read_record(h, APP)
    if rec and rec.get("values") and rec["values"][0].get("value") == MARK:
        ocs.remove_entity(h)
        old += 1

routes, trays, places = {}, {}, {}
low = None
for h in ocs.entity_handles():
    rec = ocs.read_record(h, APP)
    if not rec or not rec.get("values"):
        continue
    tag = str(rec["values"][0].get("value", ""))
    kind, _, name = tag.partition(":")
    if kind not in ("route", "tray", "place"):
        continue
    e = ocs.get_entity(h)
    p = first_point(e)
    if p:
        low = p if low is None else (min(low[0], p[0]), min(low[1], p[1]))
    if kind == "place":
        places[name] = places.get(name, 0) + 1
        continue
    bucket = routes if kind == "route" else trays
    pieces, total = bucket.get(name, (0, 0.0))
    bucket[name] = (pieces + 1, total + length(e))

rows = [["Linked", "Name", "Pieces", "Plan length (m)"]]
for label, bucket in (("Cable route", routes), ("Cable tray", trays)):
    for name in sorted(bucket):
        pieces, total = bucket[name]
        rows.append([label, name, str(pieces), "%.1f" % (total * UNITS_TO_M)])
for name in sorted(places):
    rows.append(["Board", name, str(places[name]), "—"])

if len(rows) == 1:
    print("LV summary: nothing in this drawing is linked by LV Design Studio yet.")
else:
    print("LV summary: %d cable route(s), %d tray route(s), %d board(s) linked" % (len(routes), len(trays), len(places)))
    for r in rows[1:]:
        print("  %-11s %-14s %s piece(s)  %s m" % (r[0], r[1], r[2], r[3]))
    x, y = low if low else (0.0, 0.0)
    table = ocs.add_table(rows, x, y - 3000.0, 0.0, 400.0, 3000.0)
    ocs.write_record(table, APP, [{"kind": "String", "value": MARK}])
    print("LV summary: table added below the linked objects%s." % (" (the earlier one replaced)" if old else ""))
