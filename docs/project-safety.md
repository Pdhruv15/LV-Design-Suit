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
