---
updated: 2026-10-13
tags: [sld, ux]
---

# SLD workspace UX — 2026-10-13

The user found the SLD screens hard to use. Plan agreed in 3 phases: (1) diagram workspace, (2) board-wise SLD with R / Y / B phase loading, (3) earthing screen.

## Issues found (sample project, 1440 × 900 web build)

| ID | Issue | Status |
|---|---|---|
| UX-1 | Drawing had a fixed height (`100vh − 290 px`): collapsing the ribbon or closing the banner left empty space, the system SLD stayed small | Verified fixed |
| UX-2 | Right inspector fixed at 290 px and could not be hidden; board tabs cut off ("Protection \|") | Verified fixed |
| UX-3 | Adding equipment reset the zoom to Fit (SLD review finding 3) | Verified fixed |
| UX-4 | "N fail / N to check" in the results bar was only a label; no way to find the circuit | Verified fixed |

## Changes (Phase 1, branch `sld-workspace-ux`, v1.32)

- Drawing takes the height left on the page (min 420 px); a height the user drags is still kept; double-click the handle to go back to auto.
- Inspector: header with hide button (rail to reopen), drag the left edge to resize 250–560 px (double-click = 290 px). Remembered per viewer. Board tabs wrap.
- Zoom and position kept when the network size changes; still fits on Fit, and when another project opens.
- Fail / to-check chips are buttons: each click selects the next circuit, centres it and shows "n of N".
- No colour, icon or control-size changes.

## Retest evidence (2026-10-13)

- Browser: ribbon collapsed + both panels hidden → drawing filled to the results bar. Zoomed in, added feeder TEST-1 → drawing width 1656 → 1788, view unchanged. TEST-1 at 600 m → "1 fail" → click centred TEST-1, "1 of 1", inspector showed its results. Test edits undone.
- `npm run typecheck`, `npm run lint`: pass. `npm test`: 155 files, 1167 tests pass.

## Phase 2 — board-wise SLD with R / Y / B (branch `board-sld-phases`, v1.33)

Mockup approved 2026-10-13 ("build it"); defaults taken: full circuit table on the sheet, 10 % current-unbalance check (existing app value, not a DEWA limit), earth line as text until Phase 3.

| ID | Issue | Status |
|---|---|---|
| UX-5 | Board view showed no phases; R / Y / B and Balance phases existed only on the DB load schedule | Verified fixed |
| UX-6 | No printable sheet per board | Verified fixed (PDF desktop / one sheet in browser; DXF) |

Changes:
- Design ▸ Board: ◀ ▶ previous / next board in supply order; R / Y / B strip (kW, A, neutral, unbalance against 10 %, count of single-phase circuits with no phase); phase pill on each circuit card — click moves a single-phase circuit to the next phase (a schedule circuit takes the first free way and is renamed, e.g. Y1 → B8); Balance phases for any board (schedule ways as before, then other single-phase feeders largest-first onto the lightest phase); circuit table with R / Y / B kW and totals.
- Export sheets: PDF this board / every board (one PDF in the desktop app; the browser prints one sheet), DXF this board / every board (ZIP).
- Sheet (`diagram/boardSheet.ts`): black on white; supply / incomer, busbar, circuits with ref, name, load and phase; boards with more than 12 circuits wrap onto further busbar rows (dashed continuation); panel summary beside the diagram (TCL / DF / MDL, demand current, fault level, R / Y / B load and current, neutral, unbalance, earth); circuit table full width. Numbered from the SLD drawing number (E-SLD-01 …), each sheet names its supply's sheet.

Retest (2026-10-13, sample project, 1440 × 900): SMDB-GF ↔ DB-GF1 navigation; DB-GF1 Y1 tag → B8 → R2, strip updated (2.9 % → 8.3 % → 10.8 %); Balance phases → 2.9 %; after Run the inspector shows the moved circuit. Rendered SMDB-GF and DB-GF1 sheets: no overlaps, DB-GF1 on two busbar rows. Test edits undone. `npm run typecheck`, `lint`, `test` (157 files, 1182 tests) pass; new tests check black-and-white output, sheet content, numbering, row wrapping and DXF for every board.

Known: before the next Run, the inspector of a renamed circuit falls back to the board's first result (existing stale-results behaviour).

## Phase 3 — earthing screen (branch `earthing-screen`, v1.34)

Mockup approved 2026-10-13 ("build it"); defaults: I²t included, EARTH PITS detail kept (now from the plan), test date / tester per pit.

| ID | Issue | Status |
|---|---|---|
| UX-7 | Earthing page in three narrow columns; schematic small; settings mixed with results | Verified fixed |
| UX-8 | No per-pit test date / tester; result not visible on the drawing | Verified fixed |
| UX-9 | Earthing PDF without title block; no DXF | Verified fixed (E-EARTH-01 sheet, PDF + DXF) |
| UX-10 | Board sheets said only "see earthing schematic" | Verified fixed (live path, pits, result, sheet; incomer CPC I²t) |
| UX-11 | SLD "LV EARTH PITS (n NO.)" count came from the board's own field, not the earthing plan — the two could disagree | Verified fixed (plan by default; Checks warns when a board overrides it) |

Notes:
- The drawing is rendered in a shadow root on screen: the app's dark-theme SVG text styles were overriding its black text and font sizes.
- The I²t line is the existing adiabatic check of the incomer's CPC (same as the earth-fault results). Pit / electrode conductors are not checked: in TN-S they carry no LV fault current; an HV fault needs DEWA's HV earth-fault level.
- An unchanged pit edit no longer creates an undo step or marks the project unsaved.

Retest (2026-10-13, sample project, 1440 × 900): drawing tab crisp, pits grey; E3 = 2.6 Ω via the pit editor → red, "over limit", Checks lists it, Pits tab shows 1 tested / 1 over limit; settings drawer opens beside the drawing (widened to 390 px so Linked fits); SMDB-GF board view shows "Via incomer CPC to MDB-1 MET → pits E5, E6 (not tested)" and "CPC 150 mm² Cu · I²t needs 34.9 mm² — OK"; rendered E-EARTH-01 sheet black and white with FAIL and blank lines for untested pits. Test edits undone. typecheck, lint, test (158 files, 1191 tests) pass.

### 2026-10-14 follow-up (same branch)

- User asked for the earthing schematic beside the SLD tabs: Design ▸ SLD now has **System diagram | Board | Earthing** (⌘1 / ⌘2 / ⌘3); the Earthing tab is the same screen as Design ▸ Earth pits, without the page title. The board view's "Earthing schematic ›" link opens this tab.
- The earthing **sheet** already existed in the drawing set (sheet row ＋ ▸ Earthing schematic, numbered E-ERT-001). The Phase 3 number E-EARTH-01 was replaced: the board sheets and the export now use the drawing set's earthing sheet number (or E-ERT-001 before it is added). That drawing-set sheet now prints black and white too.
- Retest: Earthing tab renders in the SLD workspace (settings drawer, export, zoom in its own bar); typecheck, lint, tests pass.

### 2026-10-14 — board sheet prefix and dark earthing canvas (v1.35)

- Board sheets numbered in their own sequence **E-DB-001, E-DB-002 …** with the drawing set's digits / suffix; prefix editable in Drawings (Board sheet prefix), next to Riser and Earthing. Replaces E-SLD-01…, which could repeat the drawing set's SLD numbers.
- Earthing drawing on screen (Design ▸ SLD ▸ Earthing and Design ▸ Earth pits) on the SLD canvas look: dark background, CAD grid (100 / 20 px), lines and text in theme colours, earth conductors green, tags blue. Exported / drawing-set sheets unchanged (black and white).
- Working view shows the schematic only: legend and notes (with the pit schedule) appear on the exported / drawing-set sheet, not on screen.
- Retest: sample project, Earthing tab dark with grid, text readable, pit editor unchanged; typecheck, lint, tests pass.

Project: [[LV Design Studio]] · Module: [[Diagrams]]
