# OpenCADStudio two-way link — plan

Status: phases 1–2 shipped in v1.59 (PR #255): **Open in OpenCADStudio** from the SLD export dialog, over a
live, token-protected localhost REST session that is reused for later exports.

Goal: engineers keep working in CAD (SLD and floor plans) and the real data flows both ways —
design → CAD for drawings, CAD → design for measured quantities — without losing anyone's work.

## Rules

- **CAD work is kept.** An update replaces only objects LV Design Studio tagged, and only for the boards and
  feeders that changed. Anything drawn by hand in CAD is never touched.
- **Nothing from CAD changes the design silently.** Pulled values arrive as a reviewable list of changes
  ("F-03 length 42 m → 57.3 m"); the engineer accepts them, then the calculations re-run.
- **Identity is the stable record ID**, not the display name, so renaming a feeder keeps its link.

## Milestones

### 3. Equipment tags (foundation)
Every exported DXF object carries extended data `LVDS` = `feeder:<id>` / `board:<id>` (R12 XDATA + APPID
table), taken from the diagram groups that already hold these IDs. Works in plain DXF export too and survives
saving as DWG. Live link gains a read: which tagged equipment is in the open drawing.

### 4. Update in OpenCADStudio (design → CAD)
Regenerate the sheet, compare per tag, delete and redraw the tagged objects of changed boards/feeders in the
open document. Untagged objects are left in place.

### 5. Tag on the floor plan
In LV Design Studio, pick a feeder or board, then click the polyline/block in OpenCADStudio
(`user_select`) to attach its tag. Re-tag and un-tag supported; a list shows what is linked.

### 6. Pull from CAD (CAD → design), reviewed
- **Cable lengths:** measured length of the tagged route polylines (+ vertical / termination allowance) →
  feeder `lengthM`; voltage drop and cable sizing re-run.
- **Board locations / rooms:** position of each tagged board block, and the room/floor it falls in.
- **Tray routes:** which tagged tray runs a cable route follows → feeder `trayRoute`, feeding tray sizing.
- **Loads from the plan:** count of light / socket / equipment blocks tagged to a circuit → board schedules.

Each pull shows a change list to accept or reject per row.

## Open questions
- Allowances for cable length (vertical drops, terminations): per project setting or per feeder?
- Which CAD blocks count as lights / sockets / equipment (block-name mapping per project)?
