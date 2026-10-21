# LV Design Studio — label every room with its area (runs inside OpenCADStudio).
# Open CAD Studio: Python Scripting → Run Script… → choose this file (or type: PY_RUN <path>/lv_room_areas.py).
#
# Every closed polyline on a layer whose name has ROOM, RM, SPACE or AREA gets a centred "nn.nn m²" label, and the
# total is printed on the command line. An outline around other rooms (a flat, a wing) is a zone and is not labelled;
# a room drawn twice counts once. Running it again replaces the labels it made before. One undo step undoes a run.
# 2D plan only. Areas assume the drawing is in millimetres (set UNITS_TO_M below for other units).

UNITS_TO_M = 0.001
LABEL_HEIGHT = 250.0  # drawing units
APP = "LVDS"
MARK = "area-label"  # extended data on the labels this script makes, so a new run can replace them
PI = 3.141592653589793


def _atan(x):
    # The script sandbox has no math module: arctangent by range reduction and its series.
    if x < 0:
        return -_atan(-x)
    if x > 1:
        return PI / 2 - _atan(1 / x)
    x = x / (1 + (1 + x * x) ** 0.5)
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


def is_room_layer(name):
    n = name.upper()
    words = n.replace("-", " ").replace("_", " ").split()
    return "ROOM" in n or "SPACE" in n or "AREA" in n or "RM" in words


def outline(e):
    if "olyline" not in e.get("kind", "") or not e.get("closed"):
        return None
    pts = []
    for v in e.get("vertices") or []:
        p = v.get("location", v)
        if isinstance(p, dict) and "x" in p:
            pts.append((p["x"], p["y"], v.get("bulge", 0) or 0))
    return pts if len(pts) >= 3 else None


def area(pts):
    twice = 0.0
    for i in range(len(pts)):
        x1, y1, _ = pts[i]
        x2, y2, _ = pts[(i + 1) % len(pts)]
        twice += x1 * y2 - x2 * y1
    a = twice / 2
    for i in range(len(pts)):
        b = pts[i][2]
        if not b:
            continue
        x1, y1, _ = pts[i]
        x2, y2, _ = pts[(i + 1) % len(pts)]
        chord = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        theta = 4 * _atan(abs(b))
        r = chord / (2 * _sin(theta / 2))
        a += (1 if b > 0 else -1) * r * r * (theta - _sin(theta)) / 2
    return abs(a)


def inside(x, y, pts):
    hit = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi, _ = pts[i]
        xj, yj, _ = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


# Labels from an earlier run are replaced.
old = 0
for h in ocs.entity_handles():
    rec = ocs.read_record(h, APP)
    if rec and rec.get("values") and rec["values"][0].get("value") == MARK:
        ocs.remove_entity(h)
        old += 1

rooms = []
for h in ocs.entity_handles():
    e = ocs.get_entity(h)
    if not is_room_layer(str(e.get("layer", ""))):
        continue
    pts = outline(e)
    if not pts:
        continue
    a = area(pts)
    if a <= 0:
        continue
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    rooms.append((a, cx, cy, pts))

rooms.sort(key=lambda r: r[0])
kept = []
for r in rooms:
    twin = [k for k in kept if abs(k[0] - r[0]) <= 0.01 * r[0] and inside(k[1], k[2], r[3]) and inside(r[1], r[2], k[3])]
    if not twin:
        kept.append(r)
labelled = [r for r in kept if not [k for k in kept if k is not r and k[0] < r[0] and inside(k[1], k[2], r[3])]]
zones = len(kept) - len(labelled)

if not labelled:
    print("LV room areas: no closed outline on a ROOM / RM / SPACE / AREA layer.")
else:
    for a, cx, cy, _ in labelled:
        label = ocs.add_text_centered("%.2f m²" % (a * UNITS_TO_M * UNITS_TO_M), cx, cy, 0.0, LABEL_HEIGHT, 0.0)
        ocs.write_record(label, APP, [{"kind": "String", "value": MARK}])
    total = sum(r[0] for r in labelled) * UNITS_TO_M * UNITS_TO_M
    print("LV room areas: %d rooms labelled, total %.2f m²%s%s" % (
        len(labelled), total,
        (" · %d zone outline(s) around other rooms left out" % zones) if zones else "",
        (" · %d earlier label(s) replaced" % old) if old else ""))
