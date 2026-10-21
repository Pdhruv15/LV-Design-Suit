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

The sample also names the Guest bedroom with a room tag block (`RM-TAG`, NAME and NO attributes).

## 7. Layer mapping and room areas — done
Architects' floor plans carry no meaning, only layers, blocks, geometry and text, so the engineer says once what
each layer is: room outline, room name, wall, cable tray, cable route, fixtures, boards or ignore (`project.cadLayers`;
first guesses from AIA-style names and what the layer holds). Command palette → *Rooms and areas from CAD floor
plan…* → Read plan → layer table → level → rooms:
- every closed polyline or hatch on a room-outline layer is a room; area measured with arc segments, in m²;
- name from a room tag block (NAME / ROOM…, number from NO / NUMBER…) inside it, else the room-name text nearest its
  centre (area labels such as "20.00 m²" skipped); unnamed rooms are "Room 1"…, renamable in the review;
- an outline around other rooms (a flat, a wing) is a zone, left out; a room drawn twice (polyline + hatch) counts once;
- room type guessed from the name (kitchen, bedroom, bathroom, living, store, plant…), or the type chosen before for
  that name (`project.cadRoomTypes`);
- review against Building information rooms on that level: same name → area update, else a new room; rooms not on
  the plan are listed and kept. Board locations use the room-outline layers of the map when set.

## 8. Auto-link from the layer map — done
With the layer map, routes and trays need no picking (2D plan geometry only):
- **Cable routes** on cable-route layers: curves whose ends coincide (≤ 0.1 m) are joined, except ends at a board
  (≤ 0.6 m from its symbol — separate cables end side by side there). The two free ends are matched to what they
  touch (≤ 1 m): board ↔ board → the feeder between them; board ↔ fixture with a CCT attribute → that circuit on
  that board. The path is oriented from the feeder's own board. Branched, looped or unmatched routes are listed with
  the reason, to link by hand. Routes linked by hand win.
- **Tray runs** on tray layers: named by the nearest label within 1.5 m ("TRAY A", "CT-2", "Cable tray B", or a short
  name on a tray layer); runs joined to a named run take its name; the rest are T1, T2…; runs linked by hand keep
  their name.
- Cable lengths and tray routes dialogs show the layer table (shared with rooms) and save the map on apply.

## 9. Layer-map templates — done
A layer mapping can be saved under the architect's or consultant's name ("ABC Architects") in the LV Database
(Library.json, `lvds.cadLayerTemplates`, synced like the other libraries). Every layer table (rooms, cable lengths,
tray routes) has the template bar: pick a template, or save the current mapping; when a saved template knows at least
two and half of a plan's layers, it is offered ("Use ABC Architects (12 of 14 layers)"). Applying sets the roles of
the layers it knows (any case) and leaves the others. Layer guesses also read RM as ROOM.

## 10. LV scripts inside OpenCADStudio — done
OpenCADStudio's bundled *Python Scripting* plugin (sandboxed RustPython: drawing access, no files / network / typed
input; a native Rust add-in would need a rebuild per OCS release) runs the LV script pack in `opencadstudio/`:
`lv_summary.py` (linked routes / trays / boards with plan lengths, as a table), `lv_room_areas.py` (m² labels,
zones and twins skipped), `lv_tag_trays.py` (selected runs + a "TRAY A" label → `tray:A`), `lv_board_check.py`,
`lv_untag.py`. Re-runs replace their own labels / table (marked with LVDS "area-label" / "summary-table").
The app ships them (`opencadstudio/**` in the package) and copies them out with *Copy LV scripts for
OpenCADStudio…*.

Later, if wanted: a native add-in with its own LV ribbon tab. 3D (elevations, vertical routes) waits for a BIM link —
see Future development.
