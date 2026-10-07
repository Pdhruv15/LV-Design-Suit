# Phase 3 — Modification proposals and impact previews

Status: proposed development handoff for Claude. Planning only; no application behaviour changed.
Predecessor: completed phase 2 design comparison and baseline work.
This phase implements D3 of the original design-modification plan. Expanded editing tools, the complete review workspace and consultant report generation follow in later phases.

## 2. User journey

Select baseline → Start proposal → Enter reason → Stage edits → Preview changes and impacts → Submit for review → Record decision → Apply accepted proposal → Run affected studies → Review actual results.

Two paths:
- Consultant: investigate a design alternative and record why the working design changed.
- Contractor: identify a discrepancy or substitution against received design and prepare a proposal without silently replacing that baseline.

The app records local decisions; workflow presets and entered names are not authenticated permissions or evidence of external approval.

## 3. First-release scope

Support proposals against an internal revision baseline for:
- Existing feeder load, power factor and demand factor.
- Existing feeder cable size, length, parallel runs, cable type and CPC.
- Existing feeder breaker type, rating, breaking capacity and settings.
- Existing board ratings and source parameters.
- Existing UPS autonomy, efficiency, SOC window, battery and surge/recharge inputs.

Initially exclude adding/removing/moving/renaming equipment and wholesale project replacement. These need topology/reference transactions in the next editing phase. Explicitly reject unsupported operations rather than silently ignoring them.

External PDF/DXF references may be attached as proposal evidence but must not be treated as an editable electrical baseline.

## 4. Screens and tools

### Modification register

List proposal ID, title, baseline, affected equipment, author/date, status and applied state. Filter by status and equipment. Show “baseline unavailable” rather than silently choosing another revision.

Actions: New proposal, Open, Compare, Duplicate as new draft, Supersede. Keep applied proposals as records; avoid deleting their evidence.

### Proposal editor

Sections: reason and origin; baseline; affected equipment; proposed values; evidence/assumptions.

Show current, expected-before and proposed values with units. The editor changes a proposal sandbox, not the working project. Cancel discards only unsaved editor changes.

### Impact preview

Tabs: Changed values; Studies affected; Drawings and schedules; BOQ quantity effect; Open checks/limitations.

Label preview results as Proposed, distinguish them from current results, and show when a preview becomes stale.

### Decision and application

Record reviewer/decision-maker name, date, decision, reason and evidence reference. Acceptance and application are separate actions.

Apply shows the exact supported edits and conflict status. Apply once as one undoable transaction. Link subsequent rerun results to the applied proposal.

## 5. Data model

Add optional proposal records to Project with an explicit schema/migration decision. Each record should contain:
- Stable proposal ID and human-readable number.
- Title, reason, origin and supporting reference metadata.
- Baseline revision ID plus content fingerprint for consistency checks.
- Status, created/updated metadata and response/decision events.
- Typed operations identifying dataset, equipment ID, allowed field, expected-before value and proposed value.
- Optional applied timestamp and resulting working-design fingerprint.

Use a discriminated union and field allowlists. Do not permit arbitrary object paths or identity/revision writes. Validate imported proposal records before applying them.

Store evidence references and semantic edits, not a duplicate full project per keystroke. Preview calculations are derived/cached; do not persist bulky computed result trees unnecessarily.

Protect applied records from accidental editing. Changes to an applied proposal create a new linked proposal; retain the original applied values and decision record.

## 6. State transitions

Draft → Proposed → Under review → Accepted / Rejected / Superseded.

Accepted → Applied is a separate application event/state. Conflict is an application condition, not an approval outcome.

- Draft: operations editable.
- Proposed/Under review: edits require return to Draft and invalidate previous decision evidence.
- Accepted: operations frozen; material edits revoke acceptance or create a new proposal.
- Rejected/Superseded: read-only historical record; duplicate to start again.
- Applied: cannot be applied twice; further edits create another proposal.

Record who entered the decision without claiming verified user authentication.

## 7. Conflict detection and atomic application

Compare expected-before values against the current working design at apply time. Missing target, changed field, changed baseline content or unsupported operation blocks application with a specific message.

Unrelated edits may coexist. Do not use a whole-project mismatch to reject unrelated metadata or pricing updates. Show each conflicting field and allow explicit reconciliation into a new reviewed proposal.

Validate the complete proposed transaction before mutation. Either all operations apply or none do. Never partly apply a proposal when one operation fails.

Perform application through the existing history boundary as a single step. Define behaviour when Undo removes an application: proposal applied status and design values must be restored together; redo must restore both.

## 8. Calculation impact and preview results

Use staleStudies/fingerprints for existing network studies. Compare the current model with the proposed sandbox to identify changed study inputs.

Optional systems such as UPS/PV are evaluated with their own current calculation helpers; they must not be omitted merely because they are absent from StudyKey.

Rerun the whole required network when necessary; do not calculate an isolated downstream circuit without its upstream system. Filter presentation to affected items while retaining full-network calculation context.

Show before/after numeric results only when both are available and based on the displayed inputs. Never use old run results as fresh before-state evidence.

Do not claim transient/BMS/manufacturer checks are verified when the calculator labels them unverified. Provide source/data assumptions alongside proposed results.

## 9. Drawing, schedule and BOQ impacts

Identify drawings containing affected boards/circuits, including downstream dependencies where the drawing content actually changes. Explain whether the impact is known or requires manual review.

Preview cable/equipment design quantities using existing quantity builders. Keep commercial overrides, manual quantities, wastage and prices separate.

Show design quantity before/after, affected BOQ key and existing rate if available. Missing rates show Unpriced; missing route measurements show Not determined, never zero savings.

Applying an engineering proposal does not silently overwrite contractor quantity adjustments. Flag adjustments tied to changed keys for reconciliation. Proposed cost differences are estimates from current project rates, not supplier quotations.

## 10. Integration and boundaries

- Design workspace: Start modification and view active-proposal indicator.
- Revisions: baseline/reference link and related proposals.
- Overview: pending proposals, conflicts and applied changes needing recalculation.
- Readiness: unresolved relevant technical checks remain pending; Accepted does not imply design approval or successful calculations.
- Project copy: Duplicate clears decision/application history by default; Save as preserves provenance according to the central copy policy.
- Revision comparison: proposal bookkeeping must not itself count as an engineering change; applying its actual values does.
- Save/recovery: persist draft proposals through existing project storage; do not introduce a second save mechanism.

Do not implement report generation in this phase. A readable on-screen comparison and machine-readable proposal record are sufficient for the first release.

## 11. Implementation batches

| Batch | Deliverable | Completion checks |
|---|---|---|
| M1 | Typed proposal model and transitions | Validation, persistence, numbering, legacy files and copy policy |
| M2 | Register and sandbox editor | Working project unchanged during edits/cancel; clear baseline/field references |
| M3 | Impact preview | Fresh before/after results, optional-system coverage, drawings and quantity limitations |
| M4 | Decisions and atomic apply | Conflict detection, accepted-operation freeze, no partial or double application |
| M5 | History/readiness integration | Undo/redo consistency, stale preview detection and accurate outstanding actions |

Implement one batch at a time. Report modified files, tests, known limits and outstanding items after each batch. Do not deploy or publish automatically.

## 12. Regression scenarios

1. Stage a cable-size change: current design and issued baseline remain identical until Apply.
2. Change only a project contact after proposal creation: application remains possible.
3. Change the target cable independently: conflict blocks application with expected/current/proposed values.
4. Remove the target: application fails without altering other targets.
5. Submit two operations, one invalid: neither is applied.
6. Accept, then alter an operation: prior acceptance cannot authorise the altered content.
7. Apply twice: second application is rejected without a new history step.
8. Undo/redo application: proposal status and design values move together.
9. Change UPS minimum SOC: battery result and optional-system impact are displayed despite no network StudyKey change.
10. Preview with stale network run: calculate fresh evidence or show unavailable; never show stale data as current.
11. Missing price/route evidence: display Unpriced/Not determined, not zero impact.
12. Save/reopen/recover: draft operations and recorded decisions survive unchanged.
13. Duplicate project: historical approval/application evidence is reset according to copy policy.
14. Issued snapshots remain unchanged through every proposal lifecycle action.

## First task for Claude

Implement M1 first: typed operations, validation, transitions, persistence/copy policy and meaningful tests. Present those foundations before expanding the UI. Existing engineering formulas stay unchanged.
