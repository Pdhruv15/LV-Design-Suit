# Project identity, safe saving and recovery

Added 5 October 2026 (Batch A of the project management plan).

**Identity.** Every project has an `id`, a `schemaVersion` and a `createdAt`. Files saved
before this get them when opened (the id is derived from the file name, so it is the same
every time); nothing is written until the next save, and opening never marks a project
unsaved. A file saved by a newer version of the app opens read-only (Save as still works).
New files are named `<name>-<first 8 of the id>.json` and never reuse an existing name.

**One copy rule** (`src/model/projectMigrate.ts`, `copyProject`). Save as and Duplicate both
make a new project with its own id, creation date and a "copied from" note, starting at status
Design. Save as keeps revision history, issued drawing history and transmittals; Duplicate
drops them.

**Saving.** The desktop app remembers what each project file was when opened or saved (time,
size, content hash). If the file is different on disk at save time (another computer, Google
Drive / OneDrive sync, another program) nothing is overwritten: a dialog lists which parts
differ and offers *Use the version on disk* (your version is kept as recoverable work),
*Save mine as a copy*, or *Overwrite with mine* (the other version is kept as
`name.json.theirs-<time>.bak`). Returning to the window also checks the open file and shows a
banner. Writes are atomic, read back and checked; a failed save shows the reason and *Retry
save*. Files that look like a sync tool's conflicted copy are flagged in the Projects list with
Compare.

**Unsaved state.** "Unsaved" compares content, not object identity: undoing back to the saved
state is clean; opening a project (earth pit IDs and cable references are filled in on open)
is clean.

**Recovery.** One recovery copy per project (desktop: `recovery/<id>.json` in the app's data
folder; web: browser storage), so one project's autosave never replaces another's. A copy
whose project file was saved again afterwards is flagged and restoring it asks before it
overwrites. The old single `recovery.json` is moved into the new folder on first start.

Code: `src/model/projectMigrate.ts`, `src/model/saveSafety.ts`, `src/model/projectStore.ts`,
`electron/projectFiles.cjs`, `src/components/SaveDialogs.tsx`.

Not yet (later batches): checkpoints and portable backups, archive and trash, wizard,
templates, received-document register.

## Projects list: search, details, archive, trash (Batch B, part 1)

- **Search and filters:** words must all appear in name, client, consultant, contractor, plot, area,
  tags, engineer or file name. Filters: status, client, year of last save, tag, Active / Archived /
  All. Every column sorts both ways.
- **Details without opening the project:** pencil button — name, status, client, consultant,
  contractor, plot, area, tags, notes. Saved with the same changed-on-disk check as a normal save;
  everything else in the project is left as it was. Renaming does not rename the file (the list
  shows the file name when they differ).
- **Archive:** a flag (`archivedAt`), hidden from the active list and Recent, nothing moves or is
  deleted; the same button brings it back.
- **Delete moves to the trash** (`.trash/` in the projects folder on desktop, browser storage on
  web). Kept 30 days, then removed for good; Restore brings it back (under a new name if the file
  name is taken); "Empty trash now" removes it at once.
- **Speed:** the desktop list re-reads a project file only when its modified time or size changed
  (cache `projects-index.json` in the app's data folder).

Code: `src/model/projectList.ts`, `src/components/ProjectsDashboard.tsx`,
`src/components/ProjectDetailsDialog.tsx`, `electron/projectFiles.cjs`.

## New project wizard and project brief (Batch B, part 2)

New project opens a five-step wizard: **name and role** (consultant, or contractor), **parties**
(authority — default DEWA — owner, consultant, contractor with contact, phone, email), **scope**,
**deliverables**, **review**. *Quick create* makes the project from the name alone, exactly as
before (no brief).

- **Brief** (`Project.brief`, `src/model/brief.ts`): role, authority, scope, parties, deliverables,
  and for a contractor with a BOQ whether it prices a new installation or a fit-out (sets
  `boq.projectType`). Owner, consultant, contractor and phone fill the existing header details
  (`info`) without erasing what is already there.
- **Scope** (LV distribution/SLD, load schedules, studies, earthing, UPS, solar, PFC, containment,
  BOQ) decides which readiness stages count on the Overview. Out-of-scope stages show "Not in
  scope", stay reachable, and are left out of the "n / m stages complete" count. Setup and Save and
  issue always count. A project without a brief counts everything, as before.
- **Deliverables** are suggested from role and scope with stable ids; changing the scope adds the
  new suggestions and removes unticked ones that are not delivered; your own and the dates/ticks
  you set are kept. Tick them off on the Overview; late ones are marked.
- **Overview card** "Scope and deliverables": Edit… (role, scope, parties, deliverables) or, for
  older projects, Set scope and deliverables….
- **Copying:** Save as keeps the brief and its progress; Duplicate keeps the brief but clears
  delivered ticks and dates.

**Changing the role keeps your work** (`withRole`): the scope you chose, deliverables you added, dated or
ticked, and the parties stay; suggestions you never touched change to the new role's. Before any edits
it takes the new role's defaults. "Reset scope and deliverables to the suggestions…" (`resetToRole`) is
the explicit way to start over.

**Readiness follows the scope for findings too:** the To do list and "Resolve issues" count only
findings from systems in the scope (a UPS failure no longer blocks a job that excludes UPS). The
excluded ones stay listed under "Outside this project's scope (n)" and reachable. Which screen belongs
to which scope item is `VIEW_SCOPE` in `src/model/brief.ts`.

**Wizard review step** shows what the project will start with and where each value comes from
(built-in, company database, your profile; `src/model/setupPreview.ts`) and where it will be saved
(with Change folder… on the desktop).

Not yet: setup templates (template selection in the wizard) and the received-document register (Batch C).
