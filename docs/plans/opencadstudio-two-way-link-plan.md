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

### 3. Equipment tags (foundation) — done (PR #256)
Every exported DXF object carries extended data `LVDS` = `feeder:<id>` / `board:<id>` (R12 XDATA + APPID
table), taken from the diagram groups that already hold these IDs. Works in plain DXF export too and survives
saving as DWG. Live link gains a read: which tagged equipment is in the open drawing.

### 4. Update in OpenCADStudio (design → CAD) — done
Regenerate the sheet, open it beside the drawing, compare per tag, copy the changed boards/feeders across and
erase their old objects; close the temporary sheet. Untagged objects are left in place. Changes are judged
against what LV Design Studio last sent to that drawing (not its CAD state), so a tagged object the engineer
edited is kept unless its board or feeder changed. Frame, title block and notes carry `sheet:<n>` so revisions
and schedules refresh too. First sheet only; continuation sheets are reopened.

### 5. Tag on the floor plan
In LV Design Studio, pick a feeder or board, then click the polyline/block in OpenCADStudio
(`user_select`) to attach its tag. Re-tag and un-tag supported; a list shows what is linked.

### 6. Pull from CAD (CAD → design), reviewed
- **Cable lengths:** measured length of the tagged route polylines (+ vertical / termination allowance) →
  feeder `lengthM`; voltage drop and cable sizing re-run.
- **Board locations / rooms:** position of each tagged board block, and the room/floor it falls in.
- **Tray routes:** which tagged tray runs a cable route follows → feeder `trayRoute`, feeding tray sizing.
- **Loads from the plan — done:** see *Loads mapping* below.

Each pull shows a change list to accept or reject per row.

## Loads mapping (done)

**What a block is** — first match wins:
1. Block named like a library reference (Loads.xlsx `Reference`, e.g. `L1`) is that item.
2. Project block map (`project.cadBlocks`): block name → library reference, with a count per block
   (twin socket `SKT-TWIN` → `S13` × 2). Edited in the pull dialog, kept with the project.
3. Anything else is listed as *to map*, never guessed. A library item needs a schedule column to be counted.

**Which circuit** — the block's `CCT` attribute (also `CIRCUIT`, `CKT`, `CCT_REF`, `CIRCUIT_REF`), e.g.
`DB-GF1/R3`, `DB-GF1 R3`, `db-gf1-r3`: longest matching board ID, then that board's phase + way.
Fixtures without the attribute, or naming a circuit not in the design, are listed and not counted.
Later: pick fixtures in CAD and choose the circuit (reuses milestone 5), and zones (closed polylines).

**Review** — per circuit: design now vs CAD (items and watts), tick to accept. The CAD point types replace
that circuit's items of those types; its other point types are kept. Applied through the schedule edit, so
auto-sized circuits re-size. Same counts and watts count as matching (no noise).

Command palette → *Loads from CAD floor plan…* → Open floor plan… (DWG/DXF in the live OpenCADStudio window)
→ Pull loads → map blocks / untick rows → Apply.

## Cable length allowances (next)
Project setting with defaults (per vertical drop, per termination, waste %), optional per-feeder override.
Length = measured route + drops + terminations, × (1 + waste); the review row shows the breakdown.
