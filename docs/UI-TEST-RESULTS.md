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
