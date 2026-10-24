# LV Design Studio development rules

LV Design Studio is an offline desktop app for LV electrical design and calculation. It uses Electron, React 18, TypeScript, Vite, Vitest, and Python engines under `engines/python`. The base branch is `main`.

## Do not change UI or UX

- Do not change the existing layout, styling, components, colours, spacing, wording, navigation, or interaction flow. This includes `src/styles.css`, `src/theme/`, and visual JSX.
- Record proposed UI/UX improvements in `docs/notes/Future development/UI UX proposals - <date>.md` and wait for approval.
- Keep PDF and report output black-and-white. Describe a mockup and wait for approval before implementing a new report format.

## Allowed improvements

- Improve calculation engines in `src/calc`, `src/engines`, and `engines/python`: correctness, standards compliance, edge cases, and validation.
- Improve the data model, database, import/export (Excel, DOCX, PDF), and headless CLI (`src/headless`, `npm run build:cli`).
- Improve performance, memory use, bug fixes, error handling, type safety, dead code, and refactors that preserve visible behaviour.
- Add unit and regression tests for all touched behaviour.
- Apply dependency and security updates within the existing semver ranges when `npm audit` reports new advisories.
- Limit CAD/floor-plan work to 2D plan geometry. Defer 3D and elevations until a BIM link exists.

## Command-only workflow

- Never launch the app, click through the UI, take screenshots, or run browser automation.
- Documentation exception: `npm run manual:capture` may launch the built app in a hidden,
  offline Electron window using only the committed demonstration project. It may capture the
  declared manual views, but must not click controls, use network access, or read user projects.
- Verify with `npm run typecheck && npm run lint && npm test`.
- Run `npm run test:pdf` only after changing PDF output, and `npm run bench` only for performance work.
- Read narrowly with `rg`/`grep` and line ranges. Do not inspect or dump `node_modules`, `dist`, `release`, lockfiles, or build output.
- Keep diffs small and focused: one topic per branch and PR. Do not reformat untouched code.
- Match surrounding code style, naming, and comment density.
- Keep reports short: what changed, which files, and test results. Round numeric results to one or two decimal places.

## Git workflow

- Other sessions share this folder. Start work from the latest main with `git fetch origin main && git checkout -b <topic> origin/main`.
- Commit, push, and open a PR. Never merge; the user merges on GitHub.
- Before deleting a branch, confirm that its PR is `MERGED`. Stop if it remains open.
- For a release batch, bump the minor version in `package.json` (for example, 1.71 to 1.72).
- If CI's security job fails on a new npm advisory, run `npm update` within range and commit the fix to the same PR.

## Future ideas

Put future-development ideas and anything requiring a user decision in `docs/notes/Future development/` as Markdown. Do not implement them without approval.
