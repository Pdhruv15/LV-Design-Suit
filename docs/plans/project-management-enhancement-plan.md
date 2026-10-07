# Project creation and management enhancement plan

Status: proposed implementation plan. No application changes are included in this planning task.
Scope: project creation, identity, settings, saving, recovery, copying, document references and the project library. Design editing, calculations, review-report generation, BOQ editing and publishing are later phases.

## 1. Current baseline

- New project asks for a name, applies database and profile defaults, and opens Overview without a saved file.
- Project settings contain system criteria and submission details, entered separately from creation.
- Desktop storage uses JSON project files, temporary-file writes, fsync, replacement and a previous-version `.bak` file. Damaged-file loading can fall back to the backup.
- Browser storage uses localStorage; saving the project and updating its index are separate operations.
- Unsaved-work recovery is a separate copy, not an issued revision or a successful project save.
- Project library supports recent files, status, opening, duplication and deletion.
- Save as retains project content including revisions; Duplicate clears project revisions and status, but the rest of the project can still contain issue history.
- Revisions freeze project content. They are different from recovery copies and ordinary save checkpoints.
- Unified readiness now covers current network results, configured UPS/solar studies and drawing checks.

Source areas: src/App.tsx; src/types.ts; src/model/projectStore.ts; electron/main.cjs; src/components/ProjectsDashboard.tsx; src/components/ProjectSettings.tsx; src/model/revisions.ts.

## 2. Target user journey

Projects → Create / Open / Copy → Basic information → Purpose and scope → Starting point and defaults → Storage and summary → Create → Overview.

Only project name is required for a draft. Missing issue-stage details appear as setup tasks; users can save an incomplete draft. Advanced electrical settings remain optional and expandable.

Creation must not automatically invent a verified design, approved status, consultant baseline or required equipment.

## 3. Creation wizard

### Step A — Identity and parties

Fields: project name; project code; client/owner; site/location; plot reference; consultant; contractor; project manager; prepared-by and reviewer names; target date.

Use a generated stable project ID independent of filename and display name. Project code is editable and can be flagged as a duplicate within the local library without prohibiting unrelated projects with the same name.

### Step B — Purpose and scope

Workflow: Consultant design; Contractor estimating; Combined workflow. These are navigation presets, not access-control or professional-approval claims.

Project type: new installation; fit-out; refurbishment; extension. Add a short scope description and exclusions.

Choose intended deliverables: drawings, schedules, calculation reports, design review report and BOQ. Store these selections as expectations; generation comes in later modules.

Record country/region and authority/reference names without automatically claiming compliance. Defaults require a visible user review.

For a contractor project, allow manual registration of received consultant document numbers and revisions. Do not claim an imported PDF or DXF is an electrically connected design model.

### Step C — Starting point

Options: blank project; saved setup template; copy an existing project.

Show what a template supplies: system defaults, project-type preferences and deliverable selections. Party names and previous-project identity are excluded by default.

Distinguish a setup template from an equipment/model template. Existing default source boards must be identified as starter data requiring review.

### Step D — Defaults and review

Show effective voltage, frequency, ambient and study defaults, with their origin: app, database, profile, template or explicit entry.

Define precedence: app → database → profile → template → explicit wizard entries. Apply once during creation; later database/profile changes must not silently rewrite a saved project.

Provide a readable summary with Edit links. Do not force engineering inputs that are unknown at project creation.

### Step E — Storage and creation

Desktop: show selected project folder and proposed filename; validate writability and collisions before saving.

Browser: clearly show that storage is in this browser and provide Download project backup.

Offer Create and save or Create draft. A failed save keeps wizard input and the project available for retry; never show Saved after failure.

## 4. Project home and management tools

- Project summary: identity, purpose, scope, parties, expected deliverables, current status and storage location.
- Setup completeness: missing details with direct links; unrelated design checks remain in readiness.
- Search/filter: name, code, client, purpose, project type, status and archived state.
- Actions: Open, Edit project details, Rename, Save copy, Start new job from this project, Export backup, Archive and Restore.
- Show explicit states: Unsaved changes; Saving; Saved at time; Save failed; Recovery available.
- Retain familiar keyboard shortcuts and unsaved-change protection.
- Archive is reversible and hides a project from the active list; deletion remains an explicit separate action.
- Store minimal lifecycle events such as creation, copy origin, recovery, archive and recorded issue references. Local activity history is not a tamper-proof audit trail.

## 5. Saving, copying and recovery contracts

### Save

Update the current project. Serialise saves to avoid an older request overwriting a newer edit. Associate each save with the content generation it captured; edits made during a save remain marked unsaved.

Retain desktop safe-write and backup behaviour. Surface backup failures where relevant. Detect an externally changed file before replacement and offer Reload or Save copy; do not silently overwrite it.

For browser storage, make project/index failures recoverable. Consider transactional IndexedDB migration with tested localStorage fallback; do not switch storage before migration is proven.

### Save copy

Create a separate project record with a new stable ID and an origin reference. Offer an explicit choice about preserving project and drawing issue history; explain the result before creation.

### Start new job from existing

New ID, name/code and creation metadata. Retain only selected design/setup content. Reset project revisions, drawing transmittals/history/issued hashes, lifecycle status, signatures/review outcomes and received-document links unless explicitly selected for reuse.

Copy policies must be centralised so every entry point behaves the same. Resetting copied history must not modify the source project.

### Recovery and checkpoints

Show recovery timestamp and originating project. Offer Recover as working draft, Open saved version and Discard recovery. Restore a checkpoint into an editable draft; keep issued revisions intact.

Use per-project recovery identity and bounded retained checkpoints rather than one ambiguous recovery record. Recovery failures must be visible; never describe recovery as a successful save.

## 6. Received documents and project references

Register document title, number, revision, date received, originator, purpose, discipline and superseded state.

First release: reference metadata and optional local links, with missing-link detection. Later release: managed document copies with explicit storage and portability rules.

Add Reference only / used as project baseline labels. Selection of a reference establishes provenance, not proof of engineering approval.

## 7. Data model and backward compatibility

Proposed optional additions: schemaVersion, projectId, projectCode, createdAt, purpose, projectType, scope, exclusions, team, targetDate, expectedDeliverables, templateProvenance, originProject, documentReferences and archive metadata.

Keep new management metadata separate from electrical inputs. Changes to contact names, purpose or archive status must not invalidate electrical calculations. Electrical criteria changes continue to invalidate affected studies.

Introduce one validation/migration boundary for desktop load, browser load, file import, recovery and duplication. Validate structure and supported schema version; report meaningful errors and preserve original files.

Legacy projects open without an upgrade wizard. Generate missing identity in memory and persist it on the next successful save. Preserve existing boards, feeders, settings, BOQ and revisions. Handle duplicate IDs on imported copies explicitly.

The project library metadata must be read consistently by both desktop and browser implementations.

## 8. Implementation sequence

| Milestone | Deliverable | Completion evidence |
|---|---|---|
| P1 — Identity and copy policy | Stable IDs, schema migration, safe copy/reset helpers | Legacy round trips; correct reset of issue history; source unchanged |
| P2 — Creation wizard | Purpose, details, defaults summary, storage and draft creation | Keyboard navigation; cancel safe; failed save retains data; quick draft path |
| P3 — Save reliability | Serial saves, accurate dirty state, external-change detection, browser recovery | Slow/concurrent save and write-failure tests; no lost edits or false Saved state |
| P4 — Project library | Search/filter, purpose badges, details editing, archive/restore | Search works across metadata; archive reversible; renamed identity stable |
| P5 — Templates and references | Setup templates, default provenance, received-document register | No accidental reuse of old parties/history; broken links reported |
| P6 — Recovery and polish | Project-specific recovery/checkpoints, backup export, setup completeness | Crash/recovery exercises; legacy/browser/desktop verification |

Deliver each milestone as a reviewable local change. Avoid rebuilding all project management in one patch. No automatic deployment or replacement of installed apps is part of this plan.

## 9. Acceptance checklist

- Existing projects open and save without loss of design or revision data.
- A draft can be created quickly with just a name.
- Consultant and contractor starting paths are visibly different but switchable.
- Defaults and their origins are visible before creation.
- Rename changes the label, not identity; filename changes are explicit.
- Copies receive new identity and consistent history treatment.
- A saved design is never overwritten by an older asynchronous save.
- Edits during saving remain unsaved until their own save completes.
- Disk-full, permission, storage-quota and external-file-change cases provide recoverable outcomes.
- Project backup can be downloaded and reopened with all embedded project data.
- Referenced external files are distinguished from files included in a backup.
- Archive/restore is reversible; deletions are explicit.
- Recovery always identifies which project and timestamp it belongs to.
- Metadata-only edits do not rerun electrical studies.
- Current engineering defaults and existing model calculations remain unchanged unless the user changes them.

## 10. Deferred to the next phase

Design baseline locking; proposed engineering modifications; calculation impact tracking; review-comment closure; consultant design review report; contractor BOQ workspace; coordinated revision and publishing package; shared accounts and role permissions.

Recommended first implementation: P1 followed by P2. Stable identity and copy rules are prerequisites for reliable creation, recovery and future design baselines.
