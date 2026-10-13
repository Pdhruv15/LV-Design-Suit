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

Project: [[LV Design Studio]] · Module: [[Diagrams]]
