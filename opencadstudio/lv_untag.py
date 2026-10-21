# LV Design Studio — remove LV links from the selected objects (runs inside OpenCADStudio).
# Open CAD Studio: select the objects, then Python Scripting → Run Script… → choose this file
# (or type: PY_RUN <path>/lv_untag.py).
#
# Removes the floor-plan links LV Design Studio uses — cable routes ("route:"), tray runs ("tray:") and board symbols
# ("place:") — from the selection. Tags on an exported SLD sheet (boards, feeders, sheet) are left alone.

APP = "LVDS"
PLAN_LINKS = ("route:", "tray:", "place:")

removed, kept = 0, 0
selected = list(ocs.selection())
for h in selected:
    rec = ocs.read_record(h, APP)
    if not rec or not rec.get("values"):
        continue
    tag = str(rec["values"][0].get("value", ""))
    if tag.startswith(PLAN_LINKS):
        ocs.remove_record(h, APP)
        removed += 1
    else:
        kept += 1

if not selected:
    print("LV untag: select the objects to unlink first, then run this script.")
else:
    print("LV untag: %d link(s) removed%s." % (removed, (" · %d SLD tag(s) left alone" % kept) if kept else ""))
