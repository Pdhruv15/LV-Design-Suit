# Consultant design to contractor BOQ: implementation plan

Created: 6 October 2026  
Source reviewed: `e182110` (LV Design Studio 1.5.0)  
Status: planned; application implementation has not started.

## Intended result

A consultant reviews a particular design, issues that design as a frozen handover, and gives the contractor a package containing the model and its documents. The contractor accepts that exact issue as the basis of an estimate. Later design changes, quantity adjustments and rate changes remain distinguishable. An issued BOQ can be reproduced from its saved commercial snapshot.

The central rule is: **every issued document and every contractor estimate identifies the exact design issue it uses.** Selecting the latest local revision must never silently change that source.

This release covers a handover for estimating. Existing project status labels such as Approved and IFC remain separate from recorded review and receipt decisions. Names continue to be recorded text in the offline app.

## What can be reused

| Existing capability | Implementation to extend |
| --- | --- |
| Project role, scope and deliverables | `src/model/brief.ts`, `src/components/BriefEditor.tsx` |
| Frozen revisions and baseline comparison | `src/model/revisions.ts`, `src/model/designBaseline.ts`, `src/components/BaselineBar.tsx` |
| Review comments, response history, PDF/Word review report | `src/model/reviewComments.ts`, `src/docs/reviewReport.ts`, `src/components/docs/ReviewView.tsx` |
| Calculation runs and stale-result detection | `src/calc/runs.ts`, `src/calc/projectReadiness.ts` |
| Study package and drawing ZIP | `src/components/docs/StudyReportsView.tsx`, `src/docs/issuePackage.ts`, `src/components/docs/sheetRender.tsx` |
| Received-document register | `src/model/receivedDocs.ts`, `src/components/docs/ReceivedDocsView.tsx` |
| Design quantities, commercial adjustments, scope checks and pricing | `src/calc/bom.ts`, `src/model/priceList.ts`, `src/model/boqScope.ts`, `src/components/docs/BomView.tsx` |
| BOQ Excel/PDF and quantity comparison | `src/docs/boqWorkbook.ts` |
| Safe save, recovery, copies and checkpoints | `src/model/projectMigrate.ts`, `src/model/saveSafety.ts`, `src/model/checkpoints.ts`, `src/model/projectStore.ts` |

The confirmed gaps are a review decision without a reviewed-state fingerprint, unrestricted revision issue, separate exports using different source objects, received-document metadata without an imported model, and BOQ generation from the live design without a saved BOQ issue.

## Delivery sequence

| Batch | Deliverable | Dependency | Release |
| --- | --- | --- | --- |
| 1 | Review tied to the design and evidence reviewed | None | First |
| 2 | Reviewed baseline issue and immutable issue record | 1 | First |
| 3 | One handover package from the issue record | 2 | First |
| 4 | Import, inspect and accept a contractor baseline | 3 | First |
| 5 | BOQ quantities derived from the accepted baseline | 4 | First |
| 6 | Estimate review and versioned BOQ issue | 5 | Follow-up |
| 7 | Role-specific readiness and complete workflow guidance | 6 | Follow-up |

Each batch should be a separate reviewable PR. UI and model changes needed to use that batch belong in the same PR. The first release is complete when batches 1–5 pass the consultant-to-contractor round trip; the full workflow is complete after batch 7.

## Shared data and compatibility rules

Introduce small, explicit contracts rather than embedding a full `Project` inside every new record:

| Contract | Required content |
| --- | --- |
| `DesignSnapshot` | Versioned, explicit selection of engineering, drawing, schedule and required rendering/header inputs; no recursive issue histories or contractor pricing |
| `ReviewDecision` | ID, structured outcome, reviewer, date, conditions, reviewed design fingerprint, review-evidence fingerprint, and dispositions for disclosed outstanding items |
| `DesignIssue` | Stable issue ID, source project ID, local revision ID, purpose/date/issuer, frozen design snapshot, snapshot hash, frozen review evidence/decision, calculation evidence and app/engine versions |
| `HandoverManifest` | Package-format version, issue identity, model hash, document inventory, member hashes, document revisions and disclosed conditions/limitations |
| `BaselineReceipt` | Receipt ID, contractor project ID, source issue/project/revision IDs, accepted date/by, immutable imported issue, source-file details, and supersession links |
| `EstimateSource` | Explicit choice of working draft or accepted receipt ID; never an implicit latest revision |
| `BoqReview` / `BoqIssue` | Baseline identity, exact commercial content fingerprint, review evidence/decision, and frozen quantities, rates, scope, totals and issue metadata |

Use canonical serialization with stable object keys and preserved meaningful array order, plus SHA-256 for persisted content/member hashes. Version the canonical representation. The current short `snapshotId` can remain a display label for legacy exports; do not use it as the new package-validation contract. Content hashes identify content and do not authenticate its author.

Keep design, review-evidence and commercial fingerprints separate. Price edits do not invalidate a design review. Changes to review findings, closure evidence, scope or dispositions can invalidate a decision even when engineering inputs have not changed. Exclude the decision itself and generated issue timestamps/history from the reviewed-state fingerprint to avoid circular invalidation.

Bump the project schema when the first new persisted contracts land, add explicit legacy migration, and retain the future-schema read-only behavior. Old decisions remain visible as legacy records requiring a fresh review before controlled handover; old revisions and received-document entries must not acquire an invented acceptance.

Every added `Project` field must be classified in `src/model/changeClass.ts` and handled by revision comparison. Issue/receipt registries are provenance/bookkeeping; commercial source selection is commercial; applying a design modification remains an engineering/drawing change. Ordinary comparisons should reference records by identity instead of expanding all archived payloads.

New revision snapshots must exclude the new history registries to prevent nested payload growth. Preserve existing revision snapshots byte-for-byte. Save as retains historical source identities and provenance while giving the working project a new identity. Duplicate starts a new job: clear reviewed decisions, issue/receipt/BOQ histories and dangling baseline pointers, while keeping reusable design and pricing inputs. Revision/checkpoint restore must preserve committed issue histories and recalculate decision freshness. Once an issue is committed, corrections use a new issue or an explicit withdrawal record; ordinary design undo must not remove committed issue history.

## Batch 1 — Review tied to reviewed state

**Build:** add `src/model/reviewDecision.ts` and a shared snapshot/fingerprint module. Extend the existing Review screen with structured outcomes: Accepted, Accepted with conditions, Changes required. Retain the reviewer's explanatory text and history.

Record the exact reviewed design and evidence fingerprints. Derive Current / Out of date / Legacy status rather than erasing a previous decision. Require conditions for conditional acceptance. Keep outstanding calculation findings and comments visible alongside the decision.

Replace the constant sheet comment stamp with a fingerprint of the sheet's relevant content, referenced equipment, title-block inputs and markups. Engineering comment closure must account for relevant upstream/project calculation inputs, not only the local feeder/board fields. A conservative engineering fingerprint is an acceptable initial fallback where dependency relevance is not yet determined.

**Primary files:** `reviewComments.ts`, `ReviewView.tsx`, `reviewReport.ts`, `projectReadiness.ts`, `types.ts`, `changeClass.ts`, `projectMigrate.ts` and their tests.

**Acceptance:** changing a load, source impedance, drawing markup or referenced equipment makes the appropriate review evidence stale; adding an unresolved finding makes the decision stale; pricing alone leaves design acceptance current. Undoing back to the exact reviewed state restores freshness. Legacy decisions remain readable without being treated as current acceptance.

## Batch 2 — Reviewed baseline issue

**Build:** add `src/model/designIssue.ts` and `src/model/issueReadiness.ts`. Add an explicit Issue reviewed baseline action to Revisions. Keep ordinary revision recording and draft exports available; an ordinary revision must not be presented as a reviewed handover.

The preflight requires a current accepted/conditionally accepted review decision, current calculation evidence for required in-scope studies, valid model references, and the required drawing/schedule set. Block unresolved critical comments, stale closures and undisposed failed/unverified checks. A conditional issue may disclose individually reviewed noncritical findings with their reason, reviewer, evidence and conditions. Reuse scope/readiness helpers and collect configured UPS, solar and other in-scope study evidence as applicable; network-run freshness alone is insufficient.

Freeze the current reviewed design and issue metadata together. Reuse a current calculation run only when its engineering fingerprints match; capture the current reviewed drawings and header information explicitly. Do not export `run.project` as if it were the newly issued revision. Supply an explicit issue context to renderers for revision/date/issue stamps.

Create the local revision and issue record in one model operation, then persist through the existing conflict-aware save path. A failed save leaves a clearly pending operation that can be retried; it must not report a committed issue. Add a read-only View issued baseline action.

**Acceptance:** calculate → review → issue produces the new revision and reviewed drawings even when no recalculation was necessary after review metadata changed. Missing/stale prerequisites produce actionable reasons. Editing the draft afterward does not change the issue snapshot or review evidence. Save conflicts/failures cannot create a falsely completed issue.

## Batch 3 — Unified consultant handover package

**Build:** add `src/docs/handoverPackage.ts` and an export action on the issued-baseline detail. Refactor existing exporters to accept the frozen issue and explicit issue context. Reuse the current PDF, DOCX, DXF and Excel generators.

The ZIP contains `manifest.json`, `design.json`, a review report, the selected study reports, the complete required drawing set and register, and relevant load/cable schedules. Include supported DXF files. Inventory required and optional members before export; unavailable PDF rendering on the browser must be shown explicitly and must not produce a package labelled complete. Use the desktop exporter for the first complete handover release.

Every document identifies the source issue and revision. All documents use the same frozen input; edits made during generation cannot mix into the package. The manifest records member hashes, versions and conditions. It lists third-party references as references unless their file bytes were actually supplied; never imply that linked files were packaged.

Package generation and file saving are separate from issue commitment. Cancelling/failing an export creates no successful export record and does not erase an already committed design issue. Retrying exports that same issue. Persist any successful export event through the normal save flow; distinguish file saved from export event saved if project saving subsequently fails.

**Acceptance:** ZIP inventory, hashes and all document stamps agree; reopening the project permits regeneration from the same issue; working-draft changes during export do not affect content. Cancelled/failed saves leave issue history correct. Visually inspect representative PDF, Excel and DXF outputs, including conditional issues.

## Batch 4 — Receive and accept the consultant baseline

**Build:** add `src/model/handoverImport.ts`, `src/model/baselineReceipt.ts` and Import handover to Received documents. Parse the selected ZIP and validate its format/schema, member inventory, hashes and model references before any project mutation. Bound archive/member sizes and reject unsafe member paths or ambiguous duplicate members.

Show a candidate preview: source project, issue/revision/date, consultant, review outcome/conditions, document inventory, calculated basis and differences from an existing accepted baseline. Acceptance creates an immutable receipt and associated received-document register entries. A document marked Baseline today remains a document reference; it is not automatically a model receipt.

Support creating a new contractor project from the candidate design and accepting into an existing contractor project. For an existing project, keep its identity, brief, parties, manual BOQ items, adjustments, rates and local histories. Store the imported design independently; do not replace the contractor's entire `Project` with the consultant's project. Source revision A and local revision A may coexist under different source project/issue identities.

A later received issue is first a candidate. Compare it and preview quantity/override conflicts before choosing it. Accepting a newer baseline retains the old receipt and all commercial inputs; it marks affected adjustments for reconciliation rather than silently rebasing them.

**Acceptance:** malformed, incomplete, incompatible or altered packages make no project changes. Duplicate import of the same issue is idempotent. Different content claiming the same issue identity is a conflict. Accepting a baseline preserves existing pricing and cannot be triggered merely by changing the document-register label.

## Batch 5 — Estimate from the accepted baseline

**Build:** add `src/model/estimateSource.ts`. Extend `BomView` with a visible quantity-source selector and source banner. Existing projects default to Working draft until a receipt is explicitly selected. Contractor projects created from a handover default to its accepted receipt.

For an accepted receipt, build design quantities from its immutable snapshot and overlay the contractor's existing `boq` and `priceList`. Use the same resolved source for BOQ scope checks, per-circuit quantities, rates templates, quantity comparison and all main BOQ exports. Clearly distinguish any existing per-circuit view that still uses illustrative rates.

Continue allowing manual measured quantities, evidence, supply/install responsibilities, package inclusions, wastage and discounts. Local design edits appear as a separate modification/draft; they do not change a baseline-based estimate. Only an explicit source change or a newly accepted issue changes design quantities.

When moving to a new baseline, retain each adjustment's captured design quantity and evidence. List changed, removed and unmatched keys for reconciliation; do not guess that a similar description identifies the same product. Export headers show the accepted source issue/revision and Draft estimate, rather than only the latest local revision.

**Acceptance:** contractor engineering edits leave baseline quantities unchanged; rate edits change price without changing the source design; receiving a newer issue does not switch the estimate. A user-selected baseline switch previews differences, preserves manual lines/rates and identifies stale/orphaned adjustments. PDF/Excel figures agree with the displayed source and totals.

## Batch 6 — Estimate review and issued BOQ

**Build:** add `src/model/boqReview.ts` and `src/model/boqIssue.ts`. Add review and issue tabs/actions inside the existing BOQ workflow. Reuse the existing `boqReview` checks, but keep commercial review decisions distinct from design review.

Bind the estimate review to its receipt/design source plus quantities, specifications, rates, currency, scope actions/responsibilities, manual lines, wastage, markup, discounts and evidence. Make a decision stale whenever those inputs change. Invalid numeric data and unresolved source/override conflicts block issue; disclosed allowances or missing/illustrative quotes require an explicit review disposition.

Issue a sequential BOQ ID with estimator/checker, date, source design identity, review decision, full commercial inputs, final priced rows and totals. Export/re-export issued PDF and Excel from that saved snapshot, so later library/rate/design changes cannot alter it. Keep draft exports labelled separately and preserve existing issued records through restores/copies according to the shared rules.

Compare two issued BOQs by design quantity, measured quantity, specification, rate, responsibility/scope and manual-line changes. Do not compare different currencies as one monetary delta without an explicit conversion basis; the first release can report the currency difference without conversion.

**Acceptance:** rate/quantity/scope edits invalidate the estimate decision; issued totals remain fixed after later edits; exports carry both BOQ revision and consultant source revision. Failed/cancelled exports create no successful export event. Comparisons explain why totals changed without applying today's rates to historical issues.

## Batch 7 — Readiness, navigation and release validation

**Build:** extend Overview, ribbon actions and help with derived role-specific stages. Add stage links as each preceding batch lands; finish the full dashboard in this batch.

Consultant: Setup → Design → Calculate and resolve → Review → Issue baseline → Export handover.  
Contractor: Receive and accept → Take off → Check scope → Price → Review estimate → Issue BOQ.

Use actual saved records, source selection and fingerprint freshness for stage completion. Editing the project status or ticking a deliverable must not certify a review or issue. Preserve existing scope exclusions and give direct links from pending stages to the necessary action.

**Acceptance:** each role sees a useful next action; relevant edits return the appropriate stage to Pending; a legacy project is usable and shown honestly; conditional issues display their conditions throughout receipt, estimate and exports.

## Validation and release gate

Add behavior-focused tests with the relevant batch, then run `npm run typecheck`, `npm test` and `npm run build` before release. Extend existing revision, review, issue-package, BOQ, migration/copy, restore/checkpoint and save-conflict coverage rather than duplicating simple UI implementation tests.

The required end-to-end fixture is: create a consultant project → calculate → close/review findings → record decision → issue Rev A → export package → open a contractor project → validate/accept Rev A → price its quantities → change the local draft without affecting them → receive Rev B → review quantity/adjustment differences → explicitly accept/use Rev B → review and issue BOQ 1 → edit rates → confirm BOQ 1 remains reproducible → issue BOQ 2 and compare.

Also verify a legacy file, conditional acceptance, unrelated pricing edits, upstream electrical changes, sheet markup edits, duplicate/copy/restore, tampered/incomplete packages, source identity conflicts, cancelled exports, disk-save conflicts and edits made during asynchronous package generation. Test more than one issued revision/receipt to catch recursive growth and accidental source switching.

Inspect representative documents visually in the desktop app: page stamps, title blocks, drawing/register revision consistency, conditions, BOQ source identity and totals. Browser behavior must disclose which documents it can produce; opening a print dialog is not evidence that a controlled package was saved.

**First implementation task:** Batch 1 — add the versioned reviewed-state contracts, fingerprint functions and review freshness behavior, with legacy migration and focused tests. Its design decisions establish the contracts used by every later batch.
