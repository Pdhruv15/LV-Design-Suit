# Phase 2 — Design and modification enhancement plan

Status: proposed handoff for implementation. This document does not change app behaviour.
Predecessor: project-management-enhancement-plan.md. User reports the previous work completed by Claude.

## Verified starting point

The current code contains stable project identity/schema migration, future-version handling, centralised Save as/Duplicate policies, project-specific recovery, project-list filters/details/archive and reversible trash. Recent commits include project-safety integration and project-list improvements.

These are implementation observations, not a claim that every milestone in the preceding plan was delivered. A creation wizard, purpose presets and document register still need confirmation before this phase depends on them. Implement a minimal optional workflow/baseline selector here if those prerequisites are absent; do not rebuild saving or project identity.

Existing design tools include connected SLD editing, board/feeder models, schedules, sizing studies, undo history, calculation fingerprints, revision snapshots, drawing checks, markup and BOQ quantity comparison.

Observed gap: src/model/revisions.ts compares selected fields/datasets. Its dataset list includes PV/building/trays/busbars/ties/substations but omits UPS systems and earthing-plan changes. Therefore “no changes since revision” is not yet a complete design-change guarantee.

## Goal and scope

Make design edits intentional, traceable and reviewable, while keeping ordinary drafting quick. Connect each material modification to its affected calculations, drawings, reports and BOQ quantities.

Consultant: design → calculate → compare → review → resolve → ready for issue.
Contractor: received baseline → take-off / estimate → identify discrepancy → propose design change → record consultant decision → update accepted working design.

Included: modification tools, baseline selection, change comparison, impact summary, safe bulk edits, review comments and design review report.
Deferred: final publishing orchestration, cloud sharing, user accounts, enforceable multi-user permissions, procurement and construction execution.

## D1 — Complete revision comparison and stable references

1. Inventory every persisted field and classify it as electrical design, geometry/drawing, quantities/commercial, project administration or transient state.
2. Extend revision comparison to UPS/battery, earthing plan/measurements, applicable equipment parameters, cable types/routes, relevant schedule attributes and drawing content.
3. Show meaningful per-item differences for major datasets, with before/after values and units; generic “changed” remains a fallback for complex nested data.
4. Separate commercial-only changes from engineering changes so pricing does not mark the electrical baseline changed.
5. Ensure rename/move/delete operations preserve or explicitly migrate references in studies, sheets, BOQ keys and earthing IDs.
6. Keep immutable equipment identity separate from editable labels where needed. Plan an explicit migration before replacing IDs used throughout the existing model.

Acceptance: UPS capacity/SOC/BMS changes and earthing edits appear in revision comparison; metadata-only and price-only edits are classified correctly; no broken references after renaming or deletion; old revisions remain readable.

## D2 — Design baseline and working draft

- Select an existing project revision as the design baseline, or register a received document set as an external reference baseline.
- Clearly distinguish an external drawing reference from an editable electrical model. An imported PDF/DXF does not automatically supply a verified calculation model.
- Display baseline revision and “working draft changed” on the design workspace.
- Preserve the selected baseline snapshot; modifications operate on the working draft.
- Offer Compare with baseline, Start modification and View baseline.
- Use workflow presets for Consultant / Contractor / Combined if available. Presets guide navigation; they are not security permissions.
- Contractor estimating can modify quantities, scope and rates without replacing the engineering baseline. Engineering edits require an explicit proposed-modification path.

Acceptance: save/reopen preserves baseline selection; draft edits leave the baseline unchanged; selecting a newer baseline does not silently overwrite the draft or BOQ adjustments.

## D3 — Modification records and impact preview

A modification record contains: ID, title, reason, origin/reference, author/date, baseline revision, affected equipment/circuits, proposed changes and status.

Suggested states: Draft → Proposed → Under review → Accepted / Rejected / Superseded. Acceptance records a decision; applying the proposal to the working model is a separate explicit transaction.

Before applying a change, show:
- Before/after design values, added/removed items and affected downstream boards.
- Studies that must be rerun, using the calculation fingerprint definitions as the source of truth.
- Drawings/schedules that contain the affected equipment.
- BOQ design-quantity changes where calculable; costs only when project rates are available.
- Assumptions, missing measurements and checks that cannot be determined automatically.

Do not invent impacts or use a stale result to claim an improvement. Proposal application must be atomic and undoable, with detection of conflicting edits made since proposal creation.

Acceptance: changing load, cable, breaker or UPS data identifies the relevant impact; a rejected proposal never modifies the working design; accepting an old conflicting proposal requires reconciliation.

## D4 — Safe design editing tools

- Multi-select board/feeder edits with an explicit scope and before/after preview.
- Copy a panel/branch with unique identities and remapped internal links; external links are explicitly selected or left unresolved.
- Move/reparent a branch with topology validation before commit.
- Prevent duplicate labels where ambiguity matters and reject cycles/orphaned mandatory references.
- Search equipment by label, type, location, level and review status.
- Keep manual sizes distinguishable from calculated recommendations; show input/data provenance.
- Group one bulk edit into one undo step. A cancelled preview changes nothing.

Acceptance: selected-only edits never affect hidden unselected items; invalid topology is rejected without partial changes; copying does not reuse equipment identity or issue history.

## D5 — Design review workspace

Each review comment stores: comment ID, category, severity, drawing/revision, equipment reference, finding, criterion/reference, required action, assigned party, response, evidence and reviewer decision.

Statuses: Open → Responded → Awaiting evidence → Closed; add Withdrawn with reason.

- Link a comment to model equipment or drawing markup where possible.
- Identify comments whose referenced object was deleted or changed.
- Reviewer explicitly closes a comment; response text alone does not close it.
- Keep automatic calculation findings separate from human comments, with links between related records to avoid duplicate work.
- Distinguish failed checks, unverified checks, observations and closed comments.
- Reopen or flag closed comments for re-review when their relevant design evidence changes; avoid reopening them for unrelated metadata edits.
- Integrate open critical findings and unverified technical checks into readiness, without claiming formal professional approval.

Acceptance: comment history survives save/reopen; responses do not auto-close; relevant changes flag prior closure evidence; no fabricated author identity or access-control claim.

## D6 — Consultant design review report

Generate from a frozen current-project snapshot with fresh results for selected studies. Block or clearly label missing/stale evidence; do not mix an older calculation project with newer review comments.

Main report:
1. Document control: report/revision/purpose, prepared and checked by, baseline and reviewed working snapshot.
2. Executive assessment: scope, principal findings, unresolved matters and reviewer recommendation.
3. Documents reviewed: drawing numbers/revisions, specifications and datasheet references.
4. Design basis: supply, demand assumptions, criteria, operating scenarios and exclusions.
5. System description and technical assessments for applicable systems.
6. Modification summary with before/after values and impact.
7. Review-comment register, responses and closure evidence.
8. Drawing/specification/schedule and quantity consistency.
9. Conclusion, conditions and limitations.
10. Appendices: detailed calculations, diagrams and supporting data.

Provide PDF plus editable Word output using the existing report infrastructure. Allow selecting sections/scope and save that setup in the project. Failed checks remain visible. No approval wording or signatures are generated without an explicit recorded reviewer decision.

A contractor technical-clarification report uses the received design reference, discrepancies, proposed changes and questions. Its BOQ basis/pricing report remains a separate document.

Acceptance: exported headings, values and comment statuses match the frozen snapshot; escaped user text; readable pagination; explicit missing-data markers; accurate document/revision references.

## Proposed implementation areas

- src/model/revisions.ts: comparison completeness and classification.
- src/calc/runs.ts: calculation impact and stale-state semantics.
- src/model/sldEdit.ts and existing topology helpers: transactional edits/copies/moves.
- src/types.ts: optional baseline, modification and review records with migration policy.
- New focused model modules: designBaseline, designChanges, designReview.
- Existing design workspace and RevisionsView: baseline/compare/impact actions.
- ProjectDashboard/projectReadiness: review and modification status.
- Existing report builders: reusable tables and calculation appendices; new design-review report assembler.
- BOQ helpers: compare design quantities independently of rates/adjustments.

## Delivery order and checks

| Milestone | First deliverable | Required verification |
|---|---|---|
| D1 | Complete comparison | Every design dataset change detected; commercial/admin classification |
| D2 | Baseline + draft | Snapshot integrity, legacy loading, contractor estimate independence |
| D3 | Proposals + impact | Atomic apply/undo, stale/conflicting proposal handling |
| D4 | Bulk tools | Topology, unique identity, scope and reference integrity |
| D5 | Review workspace | Comment lifecycle, evidence invalidation, persistence and readiness |
| D6 | Review reports | Snapshot consistency, report content and rendered page inspection |

Use meaningful regression tests for each milestone, the relevant existing tests and production build. Check report rendering visually once report generation is implemented. Do not run report exporters against user documents as a write test.

Deliver one milestone at a time. Retain existing single-edit behaviour. Do not change electrical formulas merely to implement the workflow.

## First task for Claude

Implement D1 first: audit persisted design fields, complete revision comparison for UPS and earthing, classify engineering/drawing/commercial/admin changes, and add regression tests. Include an implementation summary and any remaining dataset gaps. Then proceed to D2 after reviewing the migration and baseline model.

Do not treat this plan as instructions to deploy, publish, contact reviewers or alter external project files. All work starts as local, reviewable code changes.
