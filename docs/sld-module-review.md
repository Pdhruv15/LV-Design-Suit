# SLD module review and enhancement backlog

Reviewed 2 October 2026. Scope: source review of the system canvas, editing model, tree layout, sheet workspace and SVG export; existing automated tests. Live interaction and exported drawing appearance were not verified.

## Existing strengths

The module already supports equipment drag-and-drop, reconnection and feeder ordering, cycle prevention during board moves, undo/redo, keyboard selection/editing, inline cable edits, result layers and heatmaps, standby/outage views, drawing sheets, revision clouds, title blocks, PDF and DXF exports. Enhancements should build on these features.

## Findings

1. **P1 — Isolator symbol and text disagree in the default DEWA style.** `src/components/SystemDiagram.tsx:64` derives the device text solely from `breakerType`, whereas `src/diagram/IecSymbols.tsx:16` uses `device === 'ISOL'` to draw an isolator. The palette sets that field in `src/model/sldEdit.ts:346`. Reproduction: drop an isolator on a feeder with an MCCB breaker type; its symbol becomes an isolator but its device label still says MCCB. Use a shared device-label helper that respects the switching device. Verify the canvas and a rendered sheet with ISOL, MCB, MCCB and ACB fixtures.

2. **P2 — Moving a board does not recheck its incomer through the move recommendation path.** `src/model/sldEdit.ts:542` only applies sizing recommendations to moved feeders without `feedsBoardId`. A board move updates its upstream connection but skips the incomer and downstream feeders in this path, despite the function comment promising rechecking for a changed supply. This is a gap in automatic move behavior; a subsequent calculation can still expose failures. Add an impact review after reconnection showing affected circuits and proposed corrections, preserving deliberate manual selections. Verify moves between supplies with different upstream voltage drop and fault levels.

3. **P2 — Network edits reset canvas navigation.** `src/components/SystemDiagram.tsx:325` resets the viewBox whenever layout width or height changes. Adding equipment can interrupt the user's current zoom and position. Preserve the viewport during ordinary edits, focus new equipment when appropriate, and reserve full fitting for the Fit action and initial project load. Verify an addition while zoomed into a branch.

## Enhancement priorities

| Order | Enhancement | User benefit | Completion criterion |
| --- | --- | --- | --- |
| 1 | Shared switching-device labels | Consistent symbols and annotations | Isolator and breaker fixtures agree on canvas and sheets |
| 2 | Reconnection impact review | Makes consequences of moving a branch visible | Lists affected incomer/downstream checks and lets users review sizing changes |
| 3 | Stable viewport and focus selected branch | Faster editing of large diagrams | Edits retain zoom; selected equipment can be brought into view |
| 4 | Consolidated SLD issue navigator | Faster correction of drawing and calculation issues | Clicking an issue focuses its equipment; includes stale results and sheet checks |
| 5 | Collapse branches and search equipment | Easier navigation of large installations | Search by ID/name and expand a collapsed branch when selected |
| 6 | Export visual regression fixtures | More dependable drawing output | Compare representative large/long-label/scenario drawings, checking clipping and label agreement |
| 7 | Large-network layout optimization | Smoother interaction as projects grow | Pre-index feeders by board instead of repeatedly filtering; benchmark before and after |

Treat these as product proposals, not completed features. The issue navigator should reuse existing quick fixes and sheet checks. Large-network performance is a potential improvement inferred from repeated filtering in `src/diagram/layout.ts:55`; no performance regression was measured.

## Validation

- `npm test -- --reporter=dot`: 66 test files, 405 tests passed.
- `npm run typecheck`: passed.
- No application source changes made during this review.

Recommended first implementation scope: correct switching-device labels, add meaningful regression coverage, and preserve the viewport during editing. Follow with reconnection impact review and branch navigation.
