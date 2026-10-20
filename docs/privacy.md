# Privacy: project data, sharing samples and contributing

LV Design Studio is free and open source. Project files often hold client and site information, so the app
and this repository follow the rules below. They reduce accidental disclosure; they do not make any file or
computer secure on their own.

## Where project data is kept

| What | Where |
| --- | --- |
| Project files (`.json`) | The projects folder you chose (default `LV Design Studio Projects` in your home folder) |
| Unsaved work (recovery copies) | The app's data folder, `recovery/` (macOS `~/Library/Application Support/LV Design Studio`, Windows `%APPDATA%\LV Design Studio`, Linux `~/.config/LV Design Studio`) |
| Backups and the log of changes made by `lvds` / MCP / the API | `<projects folder>/.lvds-agent/` |
| Your profile (name, company, logo), preferences | The app's data folder (desktop); this browser's storage (web version) |
| Web version projects | This browser's storage for the site |
| Local API token while `lvds serve` runs | `api-token` in the app's data folder |

**None of this is encrypted by the app.** Files are plain JSON, readable by anyone or any program that can
read your user account's files. Protect them with your operating system: a login password, full-disk
encryption (FileVault, BitLocker, LUKS) and screen lock. There is no application-level encryption, and this
document does not add one.

**Copies you may not think of.** A projects folder inside Google Drive, OneDrive, Dropbox or iCloud is copied
to that service and to every computer signed in to it, including old versions and deleted files kept by the
service. Time Machine and other backups keep copies of the projects folder, the recovery copies and
`.lvds-agent/` backups. Exports (PDF, Excel, DXF, Word) are separate copies: delete or protect them like the
project. Clearing a browser's site data deletes web-version projects; it does not delete files you
downloaded.

**Report attribution.** An ordinary PDF report names you (your profile name) as its Author in the document
information, and title blocks show the names and logo you entered. That is intended for issued documents.

## Sharing a project to report a problem

Use **Project → Share sample** (or the command palette: *Export anonymized sample*). It makes a copy — the
open project is not changed — that keeps the panels, circuits, cables, breakers, loads, cable trays and
calculation settings, so the results are the same, and leaves out everything else:

- the project and file name, owner, consultant, contractor, phone, fax, plot, area and dates;
- people (designed / drawn / checked / approved by, created / updated by), logos and title blocks;
- notes, tags, revisions, review comments, modifications, submissions, received documents, BOQ revisions and
  variations, building, room and space data, earthing plan, substations, presets, components, price lists;
- panel and circuit names, locations, manufacturers, remarks, room names and load-item references
  (panels become P01…, circuits C001…, with neutral names, and every reference is rewritten);
- any field this version of the app does not know (it copies an explicit list of fields, not "everything but").

It saves `anonymized-sample.json` and, in the desktop app, its calculation report as a PDF with no Author.
Drawings are not exported from it.

**It is not a guarantee.** A distinctive network (unusual ratings, cable lengths, the number of circuits) can
still be recognised by someone who knows the project. Check the file before you share it.

### Manual checklist before sharing any file

1. Prefer the anonymized sample over the real project file. Share only what reproduces the problem.
2. Open the sample (or the PDF) and read it: no client, site, plot, people or company names; no logos.
3. Check the file name and the e-mail or issue title you attach it to.
4. For a PDF, check *File → Properties* (Author, Title, Subject, Keywords) and the bookmarks.
5. For screenshots, check the title bar, breadcrumbs, the projects list, status messages and any terminal or
   log text (it can show your account name in a folder path). Crop or paint over, then re-save the image.
6. Never paste an API token, a password or a key into an issue, a log or a URL. If one was shared, revoke it
   (for the local API: stop and restart `lvds serve`, which makes a new token).

## Local API

`lvds serve` listens on `127.0.0.1` only and needs `Authorization: Bearer <token>` on every request. See the
README (*Command line, MCP server and local API*) and `lvds help serve`. The token is new each time the server
starts; anyone who can read your user account's files can read it, so the same protections as above apply.

## Contributing: keeping the repository clean

- **Only fictional data.** Samples, tests, fixtures, screenshots and sample PDFs use the demo identities:
  owner *Demo Owner*, consultant *Demo Engineering Consultants*, plot *DEMO-001*, project
  *Demonstration Project — Not for Construction* (`src/data/sampleProject.ts`). Never commit a client's
  project, drawing, logo, signature, address or plot number, even in a branch: Git history keeps it.
- **Making a fixture from a real project:** export it with *Share sample*, then edit the JSON by hand to the
  smallest network that shows the problem, and check it again. Keep raw inputs in `private/`,
  `client-samples/` or `raw-samples/`, or name them `*.private.*` / `*.client.json`: Git ignores those.
- **Relative paths in documentation.** Link to `src/calc/sizing.ts`, not `/Users/<you>/…/src/calc/sizing.ts`.
- **Commit identity.** Without `user.email`, Git makes an address from your account and computer name
  (for example `<you>@<Your-MacBook>.local`) and publishes it with every commit. Use your GitHub no-reply address
  (GitHub → Settings → Emails):

  ```bash
  git config --global user.email "<id>+<username>@users.noreply.github.com"
  ```

- **Checks.** CI runs `npm run check:privacy` (personal paths and e-mail addresses in every tracked file; on a
  pull request, commit addresses made from a computer name) and gitleaks (secrets in the whole history). Run
  `npm run check:privacy` before pushing.
- **Exceptions** go in `security/privacy-allowlist.json`: the file, the exact string and a reason, only for
  something that is not personal (a fictional example, public attribution). The licence and copyright notices
  (`LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE.md`) and the package author are intentional attribution; the check
  does not look for names, so they need no exception.
- **If a secret is committed**, revoke it at its issuer first (a new key or token), then remove it from the
  files. Deleting it in a new commit does not remove it from history, forks or clones.
