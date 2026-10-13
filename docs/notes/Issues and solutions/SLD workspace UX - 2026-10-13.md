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

Project: [[LV Design Studio]] · Module: [[Diagrams]]
