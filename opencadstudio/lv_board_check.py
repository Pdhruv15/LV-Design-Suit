# LV Design Studio — list the boards on this floor plan (runs inside OpenCADStudio).
# Open CAD Studio: Python Scripting → Run Script… → choose this file (or type: PY_RUN <path>/lv_board_check.py).
#
# Lists every board symbol LV Design Studio's Board locations from CAD floor plan will find: blocks whose TAG / BOARD
# / PANEL / DB attribute names a board, and objects linked to a board by hand ("place:"). A board found twice, or a
# block with an empty board attribute, is pointed out. Nothing in the drawing is changed.

APP = "LVDS"
BOARD_ATTRIBUTES = ("TAG", "BOARD", "PANEL", "DB", "DB_REF", "BOARD_ID", "PANEL_ID")

found = {}  # board name → list of (how, x, y)
empty = 0
for b in ocs.block_references():
    attrs = ocs.block_attributes(b["handle"]) or []
    for a in attrs:
        if str(a.get("tag", "")).strip().upper() in BOARD_ATTRIBUTES:
            value = str(a.get("value", "")).strip()
            if not value:
                empty += 1
                continue
            at = ocs.block_insert_point(b["handle"]) or [0, 0, 0]
            found.setdefault(value.upper(), []).append(("attribute on " + str(b.get("name", "block")), at[0], at[1]))
            break

for h in ocs.entity_handles():
    rec = ocs.read_record(h, APP)
    if not rec or not rec.get("values"):
        continue
    tag = str(rec["values"][0].get("value", ""))
    if tag.startswith("place:"):
        e = ocs.get_entity(h) or {}
        at = ocs.block_insert_point(h) or [0, 0, 0]
        found.setdefault(tag[6:].upper(), []).append(("linked by hand (" + str(e.get("kind", "object")) + ")", at[0], at[1]))

if not found:
    print("LV board check: no board symbols found — give board blocks a TAG attribute (e.g. DB-GF1), or link them in LV Design Studio.")
else:
    print("LV board check: %d board(s) on this plan" % len(found))
    for name in sorted(found):
        marks = found[name]
        how, x, y = marks[0]
        print("  %-12s %s at %.0f, %.0f%s" % (name, how, x, y, ("  — found %d times" % len(marks)) if len(marks) > 1 else ""))
if empty:
    print("LV board check: %d block(s) have an empty board attribute." % empty)
