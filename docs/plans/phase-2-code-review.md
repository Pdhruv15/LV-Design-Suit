# Phase 2 code review — Claude handoff

Reviewed branch: design-baseline, commit a153eda, including D1 commit 5397d15.
Reviewed in an isolated archive at /tmp/lv-phase2-review; the active checkout was not switched or modified.
Validation: 932 tests across 126 files passed; production build passed with existing chunk/import warnings.
Scope delivered: D1 comparison/classification/reference cleanup and D2 internal revision baseline/working-draft display. D3 proposals/impact preview, D4 expanded editing tools, D5 review workspace and D6 report generation are not delivered on this branch. External received-document baselines are also not implemented.

## P1 — Panel rename rewrites issued snapshots

Location: src/model/renamePanels.ts, recursive walk and construction of next (around line 86).
Reproduction: issue a revision of sampleProject; rename a sub-main board; compare JSON of the issued snapshot before/after.
Observed: snapshot content changes. References inside its boards/feeders are rewritten to the new name while historical board IDs remain old. checkReferences on the historical snapshot reports missing panels.
Impact: an issued baseline is corrupted by a working-draft edit; comparison and restoration cannot be trusted.
Fix: exclude revisions and other frozen historical payloads from live-reference traversal. Preserve their content exactly; migrate historical formats only through an explicit, separately tested migration.
Regression: assert every issued snapshot remains byte-equivalent after rename, move, copy and delete, and its reference integrity remains unchanged.

## P1 — Removing a board silently changes a linked UPS to zero load

Location: src/model/integrity.ts:71, removeDanglingReferences.
Reproduction: link a UPS with an empty manual load list to a populated sample-project sub-main; delete that board.
Observed: linked demand falls from 203.27 kW to 0 kW, boardId becomes undefined, and checkReferences returns no UPS warning.
Impact: cleanup silently turns a board-fed study into an apparently valid manual-load study and loses the missing-link diagnostic.
Fix: retain an explicit unresolved source reference/status, require reassignment or deliberate removal of the UPS study, and block valid sizing/report status until resolved. Do not silently convert its source.
Regression: deleted source is reported unresolved; zero-load fallback cannot pass as valid; deliberate unlink/manual reassignment still works.

## P2 — Rounded display values are used to detect changes

Locations: src/model/datasetDiff.ts:95 and src/model/revisions.ts fieldChanges/show.
Reproduction: issue UPS endCellV=1.7501; change it to 1.7502.
Observed: changedSinceRevision returns false because both display as 1.75.
Impact: small real engineering edits can be labelled as matching the baseline.
Fix: compare raw values or a documented engineering tolerance independently of display formatting. Display enough precision to make a detected difference intelligible.
Regression: sub-0.001 changes to UPS and ordinary feeder/board inputs are detected; numerically equal values and harmless missing/empty representations follow the intended semantics.

## Completion recommendation

Fix the three findings and add regression tests before treating D1/D2 as accepted. Then implement D3–D6 in the order specified in design-modification-enhancement-plan.md. Passing current tests demonstrates the covered scenarios; it does not cover these reproduced cases.
