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

### 5. Tag on the floor plan — routes done
Cable routes: select lines / arcs / polylines in OpenCADStudio, choose the feeder in LV Design Studio, *Link
selection* (tag `route:<feeder id>`); *Unlink selection* removes it. Board symbols: found by a TAG / BOARD /
PANEL attribute naming the board, or linked by hand the same way (tag `place:<board id>`).

### 6. Pull from CAD (CAD → design), reviewed
- **Cable lengths — done:** command palette → *Cable lengths from CAD floor plan…*. Measured plan length of the
  linked curves (lines, arcs, polylines with arc segments), converted by the drawing's INSUNITS (else the
  project's unit setting) → (route + vertical + terminations) × (1 + waste), rounded up to a metre → feeder
  `lengthM`, reviewed per feeder; "length to check" is cleared on accepted rows. Run the calculations after.
- **Board locations / rooms — done:** command palette → *Board locations from CAD floor plan…*. Room = the
  smallest closed outline around the symbol on a room layer (default any layer with ROOM / SPACE / AREA, or the
  project's `cadRoomLayer`), named by the text inside nearest its centre (ALL CAPS tidied). The engineer picks the
  level the plan shows. Accepted rows set the board's `location`, `level` and `planPoint` (metres).
- **Tray routes — done:** command palette → *Tray routes from CAD floor plan…*. Tray runs are linked by name
  (*Link selection* → tag `tray:<name>`, in capitals). A feeder is on a tray where its linked cable route runs
  within 0.5 m of the tray for more than 2 m (a square crossing reads ≈ 1 m, so it does not count); the route's
  pieces are chained and oriented from the source board's `planPoint` when known, so `trayRoute` lists the trays
  in order ("A-B"). Tray route lengths come from the linked runs; tray routes named for the first time are added
  to the tray plan. Both reviewed per row.
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

## Cable length allowances (done)
`project.cadLength`: vertical per run (default 6 m), terminations both ends (3 m), waste (5 %), units when the
drawing has none (mm). Per-feeder `cadVerticalM` overrides the vertical (risers, plant rooms), set in the
review table. The row shows the breakdown, e.g. "48.2 m route + 6 m vertical + 3 m terminations, +5 % = 61 m".

## Sample
`docs/samples/sample-ground-floor-plan.dxf` (from `node scripts/make-sample-floor-plan.mjs`): the sample project's
villa ground floor in mm — 8 named rooms, SMDB-GF and DB-GF1 symbols with TAG attributes, `L1` lights and
`SKT-TWIN` twin sockets with CCT attributes (Living lighting 14 vs 12 designed, Kitchen sockets 6 vs 5), two
unlinked cable routes on `E-CABLE` and two unlinked tray runs on `E-TRAY` (link as A — vertical — and B; the
second cable route runs along A then B).

All milestones of this plan are done.
