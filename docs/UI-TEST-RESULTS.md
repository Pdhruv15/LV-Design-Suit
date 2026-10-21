# UI test results

Environment: Linux x64 cloud workspace, Node 24, Electron 44.4.5 under Xvfb (virtual display), 21 Oct 2026. Baseline is commit `6ca3d84` (unmodified `main`).

## Milestone 1 — tokens and light/dark theme

| Check | Baseline | After M1 | Result |
|---|---|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors | 0 errors | ✅ |
| Lint (`eslint . --max-warnings 0`) | clean | clean | ✅ |
| Build (`npm run build`) | ok | ok | ✅ |
| Unit tests (`npm test`) | 1652 / 1653 ¹ | **1665 / 1665** (12 new) | ✅ |
| PDF/DXF suite (`npm run test:pdf`, real Electron) | 31 / 31 ² | **31 / 31** ² | ✅ |
| PDF pixel comparison, before vs after | — | **29 page images, 18 documents, no difference** ³ | ✅ |
| SLD export in light vs dark (Chromium) | — | **byte-identical** (4,007-byte SVG) ⁴ | ✅ |
| Calculation code changed | — | none (`src/calc`, `src/engines`, `src/data`, `src/database`, `src/types.ts` untouched) | ✅ |
| Project file format changed | — | no | ✅ |

¹ One baseline failure, `src/headless/exportTools.test.ts`, was a 5 s timeout under machine load (6.7 s); it passes alone (9/9 in 3 s) and in the post-change full run. Not a defect.

² Needs `ELECTRON_DISABLE_SANDBOX=1` and a display (`xvfb-run`) when run as root on Linux. Without them all 23 Electron tests fail identically before and after the change.

³ The repository only has **macOS** visual baselines, so on Linux `visual.pdf.ts` passes *without comparing* ("No linux baselines … not compared"). To get a real comparison, Linux baselines were generated from the unmodified code, then the changed code was compared against them: all 18 documents within the suite's 0.2% tolerance. Those temporary baselines were not committed. **On your Mac, `npm run test:pdf` compares against the committed darwin baselines; run it once to confirm there.**

⁴ A throwaway harness (outside the repo) rendered SLD-style SVG with the real stylesheet and called the real `printableSvg()` with the screen in dark and then light. The outputs were identical, and the screen theme was restored afterwards.

### New tests (`src/theme/`)

- Dark tokens equal the original v1.68 values (guards against accidental look changes).
- WCAG contrast in both themes: text ≥4.5:1 on every surface, control edges ≥3:1.
- Light theme defines every dark colour token.
- Every CSS variable used in `styles.css` is defined (proven by injecting an undefined one: test fails).
- `.seg` declared once.
- Theme switching, export-theme guard (including when export throws), invalid stored theme ignored.

### Screenshots (real app, sample project, 1440 × 900)

Screens: start, project dashboard, dashboard after Run, Load assessment, SLD, Voltage drop, Preferences. Captured three times: baseline (dark), after (dark), after (light).

**Dark, before vs after: pixel diff per screen**

| Screen | Changed pixels | Cause |
|---|---|---|
| Start | 0.000% | — |
| Load assessment | 0.12% | timestamps |
| Dashboard, Voltage drop, Preferences | 0.63–0.71% | timestamps; dark scrollbars/checkboxes (D4) |
| SLD | 1.26% | timestamps; dark scrollbars; segmented control now app accent (D2/D3) |

Every changed region was inspected on the diff image; all are intended fixes or clock text that differs between runs.

**Light:** dashboard, load assessment, SLD, voltage drop and preferences reviewed. No unreadable text, dark leftovers or broken controls found.

### Not yet verified (honest gaps)

- Light theme on screens not in the tour: Earthing layout, Drawings sheet editor, Quick calculators, Help, Submissions/Revisions. Scheduled for milestone 7. The `tokens.test.ts` guard ensures they at least use defined tokens.
- Packaged app (`electron-builder` dmg/exe) was not built; the Vite build that it packages was.
- Saving and opening a project **file** through the Electron file dialog was not exercised in the GUI. Project load/save logic is covered by the existing unit tests (`saveSafety`, `projectMigrate`, `projectFiles`), all passing; the theme is not stored in the project.
- Windows rendering not checked.

### Reproduce

```bash
npm ci
npx tsc --noEmit && npx eslint . --max-warnings 0 && npm test && npm run build
# PDF/DXF (Linux as root needs the two prefixes; macOS: just npm run test:pdf)
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a npm run test:pdf
```

## Milestone 2 — header, ribbon, navigation

Environment: macOS (Apple silicon), Node, Electron from `package.json`, 21 Oct 2026. Base: milestone 1 (`ae6de76`).

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors ✅ |
| Lint (`eslint . --max-warnings 0`) | clean ✅ |
| Build (`npm run build`) | ok ✅ |
| Unit tests (`npm test`) | **1670 / 1670** (5 new in `Ribbon.test.tsx`) ✅ |
| PDF/DXF suite (`npm run test:pdf`, real Electron) | **31 / 31**, compared against the committed **darwin** visual baselines ✅ |
| Calculation code changed | none (`src/calc`, `src/engines`, `src/data`, `src/database`, `src/types.ts` untouched) ✅ |
| Project file format changed | no ✅ |

**Measured in the running app** (Vite, web version, sample project):

| Width | Header height before | After |
|---|---|---|
| 1280 px | 89 px (two rows: Download file and Profile wrapped) | **49 px**, one row |
| 1200 px | two rows | **49 px**, one row, no overflow |
| 1000 px | wraps | wraps (unchanged, by design below 1200 px) |

Checked by eye in dark and light: Project, 3 Detailed design, BOM / Cost and Standards ribbons (captions present), the Now badge on the selected and unselected tab, the unsaved dot and "unsaved" under Save, and the status bar icons.

### Not yet verified

- The desktop (Electron) window was not screenshot-toured; the web build shares the same header and ribbon code, minus the Download file button, so the desktop header is narrower than the case measured.
- Windows rendering not checked.

## Milestone 3 — forms, buttons, dialogs, validation

Environment: macOS (Apple silicon), 21 Oct 2026. Base: milestone 2 (`7babe10`).

| Check | Result |
|---|---|
| TypeScript, lint, build | clean ✅ |
| Unit tests (`npm test`) | **1678 / 1678** (8 new: `ConfirmDialog.test.tsx` 5, `ui.test.ts` 3) ✅ |
| PDF/DXF suite (`npm run test:pdf`) | **31 / 31**, compared against the committed darwin baselines ✅ |
| Drawing text sizes | unchanged: every changed rule cross-checked against the 79 classes used on SVG elements; the one name match (`.tcc-wrap .legend`) is an HTML list ✅ |
| Calculation code changed | none ✅ |

New tests: question text split into title and detail; answers resolve one dialog at a time; Escape answers No; destructive questions start on Cancel; focus moves in, Tab wraps both ways, focus returns to the opener (also when a field has `autoFocus`); numbers read as typed (1,250 · 12,50,000 · 0,8 · −5) and out-of-range values explained, not clamped.

**In the running app** (web version, sample project, 1280 × 800):

- Ribbon Delete with MDB-1 selected → dialog "Delete MDB-1 and everything fed from it?", focus on Cancel, red "Delete MDB-1". Escape closed it, MDB-1 kept, focus back on the Delete button.
- Load assessment, GFA = −500 → red edge, "Enter 0 or more m²", value not saved.
- Voltage drop limit = 0 → "Enter more than 0 %", limit stays 4 %.
- Command palette opens with focus in its search box; Escape returns focus to Search. (This check found a bug, fixed before commit: an `autoFocus` field made `<Modal>` remember the wrong element.)

### Not yet verified

- Each of the 27 converted dialogs was not opened one by one in the GUI; they share `<Modal>`, the conversion was mechanical and type-checked, and the shared behaviour is unit-tested. The CAD dialogs need OpenCADStudio and were not opened.
- Electron desktop window and Windows not checked.

## Milestone 4 — tables and results

Environment: macOS (Apple silicon), 21 Oct 2026. Base: milestone 3 (`e20da62`).

| Check | Result |
|---|---|
| TypeScript, lint, build | clean ✅ |
| Unit tests (`npm test`) | **1680 / 1680** (2 new: `ResultCard.test.tsx`) ✅ |
| PDF/DXF suite (`npm run test:pdf`) | **31 / 31**, darwin baselines ✅ |
| Calculation code changed | none; the new cards only show figures already calculated for the tables ✅ |

**In the running app** (web version, sample project, 1440 × 900):

- Cable schedule (36 rows): scrolled 200 px down and 400 px right inside the table; header row stayed at the top edge and the cable tag column at the left edge; rows 32 px.
- Earthing cards: worst loop DB-EV 0.2656 Ω PASS (max Zs 0.3613 Ω, same as the table row), 36 circuits 36 pass, source data complete, protective conductors adequate.
- Voltage drop: worst case "2.57 % PASS" (the word is new), other cards unchanged.

### Not yet verified

- BOQ bill and per-circuit cost table were not scrolled in the GUI (same `.table-scroll` rule as the cable schedule).
- Selection and Coordination cards checked by type and unit test only, not opened in the GUI.
- Electron desktop window and Windows not checked.

## Milestone 5 — SLD editor

Environment: macOS (Apple silicon), 21 Oct 2026. Base: milestone 4 (`bb5e2b5`).

| Check | Result |
|---|---|
| TypeScript, lint, build | clean ✅ |
| Unit tests (`npm test`) | **1681 / 1681** (1 new: export lookup finds the drawing, not a toolbar icon; it also proves the old selector would have picked an icon) ✅ |
| PDF/DXF suite (`npm run test:pdf`) | **31 / 31**, darwin baselines, after the export-lookup change ✅ |
| Calculation code changed | none ✅ |

**In the running app** (web version, sample project, 1440 × 900):

- Toolbar shows the Drawing and View groups; icons 15 px; `.sysdiag > svg` is the drawing (has its data size).
- Drawing focused: + → 125 %, + → 156 %, → pans the view by 10 % of its width, 0 → 100 %.
- Board properties (MDB-1, General tab): headings General and On the SLD (the duplicate heading over the framed On the SLD group was removed before commit).
- Palette: group headers are buttons (expanded = true), search "RCD" lists results, Escape clears the search.

### Not yet verified

- A PDF / DXF export started from the SLD export dialog in the GUI (covered by the unit test of the lookup and by the PDF suite's sheet exports).
- Electron desktop window and Windows not checked.

## Milestone 6 — reports and export

Environment: macOS (Apple silicon), 21 Oct 2026. Base: milestone 5 (`dc71cdc`).

| Check | Result |
|---|---|
| TypeScript, lint, build | clean ✅ |
| Unit tests (`npm test`) | **1685 / 1685** (4 new in `PaperPreview.test.tsx`: page read from `@page`, named pages ignored, fallback, exported HTML untouched) ✅ |
| PDF/DXF suite (`npm run test:pdf`) | **31 / 31**, darwin baselines ✅ |
| Calculation / export code changed | none (export functions and their HTML untouched; only the buttons moved) ✅ |

**In the running app** (web version, sample project, 1440 × 900): the strip shows Scope, Revision, Save to and the formats on Calculation report, Study reports (Excel, Word, Issue package, Export PDF primary), Export centre (One PDF primary; the "needs the desktop app" reason shown in words) and the SLD export dialog (Save details, SVG, DXF A3, PDF A3 primary). Calculation report preview: A4 landscape sheet, 1123 px wide at 100 %, margin guides, label "A4 landscape · margins 21 / 14 / 16 / 16 mm".

### Not yet verified

- Exports were not run from the GUI in this milestone (the export functions did not change; the PDF suite passes).
- The desktop "Save to" wording was not seen in Electron (the web wording was).

## Milestone 7 — final consistency review

Environment: macOS (Apple silicon), 21 Oct 2026. Base: milestone 6 (`1f96729`).

| Check | Result |
|---|---|
| TypeScript, lint, build | clean ✅ |
| Unit tests (`npm test`) | **1685 / 1685** ✅ |
| PDF/DXF suite (`npm run test:pdf`) | **31 / 31**, darwin baselines ✅ |
| `npm audit --omit=dev` | 0 vulnerabilities ✅ |
| `npm run check:privacy` | 881 files, 0 findings ✅ |
| Calculation code changed | none ✅ |

**Screen tour** (web version, sample project, 1440 × 900, run in the browser pane): 46 screens × 2 themes. Before fixes: dark 25 findings, light 80 (most were one header chip, see below). After fixes: none in either theme apart from the protection legend swatches (data colours, now tokens). Ribbon: no tab overflows at 1440 px (was Detailed design 24 px, BOM / Cost 103 px).

Tour artefact, not a defect: in the hidden browser pane CSS transitions do not advance, so a chip that was on screen when the theme switched kept its 0.12 s background transition frozen at the dark colour (`getAnimations()` showed it running at time 0). In a visible window it completes at once.

### Not yet verified

- Electron desktop window and Windows (all checks here ran in the web build of the same code).
- Figma variables are not updated with the three light-theme changes (`--bus`, `--ok`, `--mut`) or the new `--curve-*` tokens: the Figma connector is not connected in this session.

## Follow-up — text-input dialogs (prompt() replaced)

Environment: macOS (Apple silicon), 21 Oct 2026. Base: `03f2f5a` (Version 1.69).

| Check | Result |
|---|---|
| TypeScript, lint, build | clean ✅ |
| Unit tests (`npm test`) | **1688 / 1688** (3 new: form values trimmed from one form, first field focused; required field blocks Save with "Required" and `aria-invalid`; Cancel / Escape give null; choice list) ✅ |
| PDF/DXF suite (`npm run test:pdf`) | **31 / 31**, darwin baselines ✅ |
| `window.prompt(` left in `src` | none (only the no-host fallback inside `ConfirmDialog.tsx`) ✅ |
| Calculation code changed | none ✅ |

In the running app: Changes → New modification… opens one form (Title, Why? (optional), Where does it come from? (optional)), focus in Title; Escape closed it, nothing was created, focus returned to the button. A layout fix was made before commit: "(optional)" sat on its own line because a general modal-label rule stacks label contents.

Not opened in the GUI: the markup, sheet and review forms (same component, unit-tested).
