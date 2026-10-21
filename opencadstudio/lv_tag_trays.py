# LV Design Studio — name tray runs from their label (runs inside OpenCADStudio).
# Open CAD Studio: select the tray runs (lines, arcs, polylines) AND one label text such as "TRAY A", "CT-2" or "B",
# then Python Scripting → Run Script… → choose this file (or type: PY_RUN <path>/lv_tag_trays.py).
#
# The selected runs are linked to that tray route (extended data "LVDS" = "tray:<name>"), as Link selection does in
# LV Design Studio's Tray routes from CAD floor plan. The label names the route, because a script cannot ask for
# typed input. Runs already linked to another tray route are relinked.

APP = "LVDS"


def tray_name(text):
    """ "TRAY A" / "Cable tray B" / "CT-2" / "C.T. 3" / "A" → the route name in capitals, else None."""
    t = " ".join(str(text).upper().replace("\\P", " ").split())
    if t.startswith("CABLE "):
        t = t[6:]
    for prefix in ("TRAY", "C.T.", "CT"):
        if t.startswith(prefix):
            t = t[len(prefix):].lstrip(" -:#.")
            break
    ok = 0 < len(t) <= 6 and all(c.isalnum() or c == "-" for c in t) and t[0].isalnum()
    return t if ok else None


texts = {}
for row in ocs.text_entities():
    texts[row["handle"]] = row.get("value", "")

selected = list(ocs.selection())
names, runs, other = [], [], 0
for h in selected:
    e = ocs.get_entity(h) or {}
    kind = e.get("kind", "")
    if h in texts:
        name = tray_name(texts[h])
        if name:
            names.append(name)
        else:
            other += 1
    elif kind in ("Line", "Arc") or "olyline" in kind:
        runs.append(h)
    else:
        other += 1

names = sorted(set(names))
if not selected:
    print("LV tag trays: select the tray runs and one label (e.g. TRAY A) first, then run this script.")
elif len(names) != 1:
    print("LV tag trays: select exactly one tray label with the runs (found: %s)." % (", ".join(names) or "none"))
elif not runs:
    print("LV tag trays: no lines, arcs or polylines selected for tray %s." % names[0])
else:
    for h in runs:
        ocs.write_record(h, APP, [{"kind": "String", "value": "tray:" + names[0]}])
    print("LV tag trays: %d run(s) linked to tray route %s%s." % (len(runs), names[0], (" · %d other object(s) skipped" % other) if other else ""))
