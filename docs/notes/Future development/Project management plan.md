# Project management plan — identity, creation, saving, archive, templates, recovery

_Drafted 2026-10-05. Decisions D1–D7 confirmed 2026-10-05 (all recommendations accepted). Batch A (items 1, 3 and per-project recovery) in progress on branch `project-safety`. Dubai / DEWA first; international profiles stay on hold ([[International authority profiles - review - 2026-10-04]])._

Up: [[Future development]] · [[Status]] · Related: [[Project data]]

## 1. Where we are today (read from the code on `main`, 7b05f0f)

| Area | What the code does now | Where |
| --- | --- | --- |
| Identity | A project is its **file name** (`<slug>-<timestamp>.json`). No project ID, no schema version, no created date. Name and file can drift. | `electron/main.cjs` `projects:save`; `src/model/projectStore.ts` |
| Copying | **Save as** keeps everything (revisions, status). **Duplicate** clears revisions and status. Two different rules for "a copy". Opening a file from outside the folder opens it as a new unsaved project. | `App.tsx` `saveAs`, `duplicateFile`; `projects:pick` |
| Creating | One name prompt, then `applyDefaults(applyParameters(newProject(name), db), prefs)`. No role, scope, parties or deliverables. | `App.tsx` `startNewProject`; `types.ts` `newProject` |
| Saving | Atomic write (temp file, fsync, rename) plus one `.bak`. **No check that the file changed on disk since it was opened.** Save always overwrites. | `main.cjs` `writeFileSafe` |
| Unsaved status | `dirty = project !== saved` (object identity). Reloading or undo can leave it wrong either way. Status change on a non-open project edits the file without updating `updatedAt`. | `App.tsx` lines ~131, 495 |
| Dashboard | Search over name / owner / plot / area / engineer / file; status filter; open, duplicate, **permanent delete** (`unlinkSync`). Only status is editable. | `ProjectsDashboard.tsx`; `projects:delete` |
| Listing speed | `projects:list` reads and parses **every** project file on every refresh. | `main.cjs` `projects:list` |
| Defaults | Chain is built-in → company database parameters → profile preferences, but the project does not record which value came from where. | `App.tsx` `startNewProject` |
| Recovery | **One** global `recovery.json` in the app's data folder, overwritten by whichever project autosaved last. Written on a timer and on window close. | `main.cjs` `recovery:*`; `App.tsx` autosave effects |
| Backup | Only the single previous version, `name.json.bak`. | `writeFileSafe` |

Consequence: the data-safety risks are #3 (silent overwrite when the projects folder is on Google Drive / OneDrive, which your own settings text recommends) and #6 (recovery of project A is lost the moment project B autosaves). Those two decide the order below.

## 2. Principles

1. **Never lose work, never silently overwrite.** Every write has a known "what was on disk" check and a way back.
2. **Old files keep opening.** All new fields optional; a migration step stamps them; opening alone never marks a project unsaved.
3. **Pure logic in `src/model/`, thin Electron handlers.** Conflict decisions, copy rules, retention and migration are plain functions with unit tests. `main.cjs` only does file I/O.
4. **Desktop first, web version degrades gracefully** (browser storage is small, so checkpoints and backups are file-based on desktop; web gets export/import only).
5. **Dubai / DEWA defaults.** No multi-country machinery.

## 3. Enhancements, in your order

### 1. Stable project identity, legacy migration, consistent copy rules

**Data model** (all optional additions on `Project`):
- `id` (UUID), `schemaVersion` (integer, starts at 1), `createdAt`.
- `origin?: { copiedFromId, copiedAt, kind }` for lineage.

**Migration** — new pure `migrateProject(p, fileName?)` in `src/model/projectMigrate.ts`:
- Missing `id`: derive a **deterministic** legacy ID from the file name (`legacy-<hash>`) so two opens before a save agree. Files opened from outside the folder get a random UUID once.
- Stamp `schemaVersion`, backfill `createdAt` from the earliest revision or `updatedAt`.
- Opening must **not** make the project dirty: the migrated copy becomes the `saved` baseline; the stamp is written on the next real save.
- `schemaVersion` newer than this app supports: open read-only with a clear warning (no silent downgrade).

**One copy function** `copyProject(p, kind, opts)` replacing the ad-hoc code. Proposed rules (**decision D1**):

| Carried into the copy | Save as (a branch) | Duplicate (similar job) | Template use |
| --- | --- | --- | --- |
| New `id`, `origin` set | yes | yes | yes |
| Boards, feeders, loads | yes | yes | no (setup only) |
| Revisions, issue history, transmittals | yes | **no** | no |
| Status | reset to Design | reset to Design | Design |
| Drawing sheets and markups | yes | yes (hash cleared) | optional |
| Parties / brief | yes | yes | from template |

**File naming**: keep existing file names; new files are `<slug>-<shortid>.json`. Renaming a project does not rename its file; the dashboard shows both when they differ.
**UI**: duplicate-name warning; "Copied from …" line in Project settings.
**Tests**: migration of old/new/future files; copy rule table; ID stability across reopen.
**Size**: M. **Risk**: low if migration is idempotent.

### 2. Creation wizard — consultant / contractor path, scope, parties, deliverables

**Flow** (skippable; "Quick create" keeps today's one-prompt path):
1. **Role** — Consultant design, or Contractor (ties to the existing BOQ contractor-scope work).
2. **Details** — name, plot, area, client, authority (default DEWA).
3. **Scope** — tick what applies: LV distribution/SLD, load schedules, studies (voltage drop, fault, earthing, selection, coordination), UPS, solar, PFC, containment, BOQ.
4. **Parties** — owner, consultant, contractor, authority; name, company, contact.
5. **Deliverables** — chosen from a list per role (e.g. SLD set, load schedules, calculation report, BOQ, as-built), each with target date and status.
6. **Setup** — pick a setup template (item 5) or defaults; review and create.

**Data**: `Project.brief = { role, scope: string[], parties: Party[], deliverables: Deliverable[] }`; existing `ProjectInfo` fields stay and are filled from steps 2 and 4 (no duplication).
**Integration**: the Overview "Project readiness" stages (already added in 1.3) skip stages outside the scope; deliverables feed the drawing register and issue package; contractor path preselects BOQ contractor scope.
**Tests**: wizard output → `Project` shape; readiness respects scope.
**Size**: L (UI-heavy). **Depends on**: 1 (copy/templates use IDs).

### 3. Reliable saving, accurate unsaved status, external-file conflict detection

**Conflict check**: the app remembers a **stamp** for each open file (modified time, size and content hash) from open/save. `projects:save` receives the expected stamp and returns `{ file, stamp }` or `{ conflict, diskStamp }`. Pure `decideSave(expected, disk)` decides; unit tested.
**Conflict dialog**: *Keep mine (overwrite)* · *Save mine as a copy* · *Load the file on disk* · *Show what differs* (top-level section list: boards, feeders, drawings, …). The overwritten version is checkpointed first (item 6).
**Notice without saving**: re-check the stamp when the window regains focus; banner "This project changed on disk".
**Cloud-sync conflicts**: detect sibling files such as `name (conflicted copy).json` / `name-DESKTOP-ABC.json` and list them on the dashboard with "Compare / Open".
**Accurate dirty state**: replace reference equality with a hash of the serialised project, compared with the saved hash (debounced); reopening or undoing to the saved state shows clean; real edits show unsaved.
**Save feedback**: states Saving → Saved (time) or **Failed with reason and Retry**; the recovery copy is cleared only after a confirmed save; title bar, tab and dashboard row all agree.
**Verification**: after writing, re-read and parse before reporting success; web version handles full-storage errors with a clear message.
**Status edits on other files** (`setFileStatus`): go through the same safe path and update `updatedAt`.
**Size**: M–L. **Risk**: medium (touches every save); mitigated by pure-function tests and keeping the atomic write.

### 4. Project search, filters, details editing, reversible archive

- **Search/filter**: add client, consultant, contractor, tags, authority, role, year; sort by any column; filters for Active / Archived.
- **Details editing in place**: a side panel on the dashboard to edit name, client, plot, area, status, tags, notes **without opening the project**, via a main-process `projects:patchMeta` that patches top-level fields atomically (with `.bak`) and runs the item-3 conflict check.
- **Archive**: `Project.archivedAt` flag (hidden by default, one click to restore). **Decision D2**: flag only (recommended) vs moving the file to an `Archive/` sub-folder.
- **Delete becomes reversible**: move to `.trash/` (kept 30 days, restore button, "Empty trash" is the only permanent delete). Replaces `unlinkSync`.
- **List performance**: cache each file's metadata in `projects-index.json` keyed by modified time and size; only changed files are re-parsed.
**Size**: M. **Depends on**: 1 (IDs), 3 (safe patching).

### 5. Setup templates, default-source visibility, received-document register

- **Setup templates**: "Save this project's setup as a template" stores settings only (voltage, frequency, ambient, voltage-drop limit, study settings, point template, panel prefixes, title block and drawing notes, parameters, feeder presets, price list reference) — never boards or feeders. Stored with the company library (add `lvds.projectTemplates` to the keys in `librarySync.ts`) so teams share them. Chosen in the wizard or applied later (with a diff preview).
- **Default-source visibility**: record where each setting came from — *Built-in*, *Company database*, *Profile*, *Template X*, *Project override* — at the moment each stage of `startNewProject` applies it. Project settings shows a small badge per field with *Reset to default*. Needs a `setupSource` map on the project.
- **Received-document register**: `Project.received[]` with title, reference, from (client / authority / architect / contractor), date received, type, revision, status (current / superseded), note, optional file path. References only — files are not embedded, to keep project files small. Marking one *superseded* by another keeps the chain; an "Unreviewed received documents" check is added to the readiness list; export as a sheet in the issue package ("basis of design"). Dubai examples: DEWA NOC / load letter, architectural drawing revisions.
**Size**: L (three parts, split into three PRs). **Depends on**: 1, 2.

### 6. Project-specific recovery, checkpoints, portable backups

- **Recovery per project**: `recovery/<projectId>.json` instead of one global file; each records the file stamp it was based on. At startup list all recoveries newer than their saved file, with a per-project Restore / Discard. Fixes "A's recovery is overwritten by B".
- **Checkpoints**: snapshots in `<projects folder>/.checkpoints/<id>/<time>-<label>.json.gz`, taken automatically at: issuing a revision, before a migration, before overwriting after a conflict, before bulk operations (renumber, split sheets, apply template), and on demand ("Create checkpoint…"). Retention (**D5**): keep the last 20 automatic ones plus every labelled one. Restore opens it as a copy, or replaces the current project after checkpointing it.
- **Portable backup**: *Export backup* writes a `.lvds-backup.zip` containing the project, its checkpoint list and a manifest (project ID, schema and app version, content hash, date). *Import backup* verifies the hash and offers open-as-copy or replace. Optional whole-folder backup.
- **Web version**: no checkpoint folder; offers export/import backup only (browser storage is too small for history).
**Size**: L. **Depends on**: 1 (IDs), 3 (stamps).

## 4. Order, batches and versions

Your order is kept, with one adjustment: the **per-project recovery slice of item 6** moves forward because it is small, keyed only by the new ID, and fixes real data loss.

| Batch | Version | Items | Why together |
| --- | --- | --- | --- |
| A — data safety | v1.4 (with sheet markups) | 1, 3, per-project recovery from 6 | Everything else builds on IDs and safe saves. |
| B — daily use | v1.5 | 2, 4 | Wizard and dashboard both read the new identity and brief data. |
| C — setup and history | v1.6 | 5, rest of 6 | Templates and checkpoints build on B. |

Each item is one or more small PRs (model + tests first, then UI), run through typecheck and the full test suite before merge, as for PR 125/126. Version bump happens in the last PR of each batch.

## 5. Cross-cutting

- **Tests**: migration, copy rules, `decideSave`, retention, recovery selection, metadata cache invalidation, index patching; a temp-folder test for the Electron file operations by moving the logic into a module the tests can import.
- **Compatibility**: files are never downgraded; unknown fields are preserved on save; a future-version file opens read-only.
- **Performance**: hashing and index work stay off the typing path (debounced / main process).
- **Security**: keep the existing `projectPath` guard (no paths outside the projects folder); backup import validates the manifest and size before reading.
- **Docs**: update [[Project data]] and the Help guide; add an Issues-and-solutions note per batch.

## 6. Decisions (all confirmed: recommendations accepted)

- **D1** Copy rules table in item 1 — confirm Save as keeps revision history, Duplicate drops it.
- **D2** Archive = flag only, or also move to an `Archive/` folder.
- **D3** Wizard: optional (Quick create stays) or mandatory for new projects.
- **D4** Setup template content: settings only (recommended), or optionally include sheets / title blocks / BOQ rates.
- **D5** Checkpoint retention (last 20 automatic + all labelled) and the 30-day trash period.
- **D6** Received documents: references only (recommended) or also copy files beside the project.
- **D7** Batch grouping above, and whether item 1 + 3 ship in v1.4 alongside the sheet markups.

## 7. Risks

- Saving is the most sensitive code path: change it behind unit-tested pure functions and keep the atomic write and `.bak` as they are.
- A hash-based dirty check on very large projects could be slow: debounce and measure on the largest sample before adopting.
- Cloud-sync folders can still produce conflicted copies outside our control; detection and compare are the mitigation, not prevention.
- Wizard scope must not hide capabilities permanently: out-of-scope stages stay reachable, just not counted in readiness.
