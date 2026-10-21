# UI/UX audit — LV Design Studio

Audit of commit `6ca3d84` (v1.68.0, `main`), 21 Oct 2026. Every finding below was confirmed in the code or in a screenshot of the running app; nothing is assumed.

## 1. Architecture

| Layer | What it is |
|---|---|
| Shell | Electron 44 (`electron/main.cjs`), loads the Vite build; also runs in the browser ("web version", `src/util/webApp.ts`) |
| UI | React 18 + TypeScript 5, no UI component library |
| Styling | One global stylesheet, `src/styles.css` (1,586 lines), plus 413 inline `style={{}}` blocks |
| Icons | `lucide-react` (11 files) and Unicode glyphs in text (▶ ⚠ ✕ ✓ ▾) |
| State | React state in `App.tsx` (1,757 lines); preferences in `localStorage` (`src/model/profile.ts`) |
| Exports | PDF via Electron print, DXF and SVG from the live SLD (`src/diagram/exportSvg.ts`), Excel (`exceljs`), Word (`docx`) |
| Tests | Vitest: 1,653 unit tests (212 files) + 31 PDF/DXF tests driving real Electron |

No styling framework (Tailwind, CSS modules, CSS-in-JS) is used, and adding one is not justified: the existing global stylesheet already had a partial token layer to build on.

## 2. Modules confirmed in code

From `src/views.ts` and the ribbon. All present:

| Requested module | Where | Status |
|---|---|---|
| Dashboard | `ProjectDashboard.tsx`, `ProjectsDashboard.tsx`, `SystemSummaryCards.tsx` | ✓ |
| Load assessment | `docs/LoadAssessmentView.tsx`, `calc/loadAssessment*.ts` | ✓ |
| SLD | `SystemDiagram.tsx`, `SingleLineDiagram.tsx`, `sld/SheetWorkspace.tsx`, `EquipmentPalette.tsx`, `SldExportDialog.tsx` | ✓ |
| Voltage drop | `studies/VoltageDropStudy.tsx` | ✓ |
| BOQ | `BoqTable.tsx`, `docs/BomView.tsx` (ribbon: *BOM / Cost*) | ✓ |
| Reports | `docs/StudyReportsView.tsx`, `docs/ExportCentre.tsx`, calculation report | ✓ |

The app also has studies not named in the brief: earthing, protection coordination, breaker & cable selection, transformer & generator sizing, PFC, UPS, solar PV, busbar, plus documents (DB/cable/tray schedules, revisions, submissions, drawings register).

Navigation is a **stage ribbon** (Project · 1 Concept · 2 Schematic · 3 Detailed design · Documents · 4 Tender and IFC · BOM / Cost · Standards) over a panel tree and an inspector panel. The left `.nav` menu styles exist for narrow layouts.

## 3. Defects found

| # | Defect | Evidence | Fixed |
|---|---|---|---|
| D1 | `--border`, `--accent`, `--fg`, `--muted` used but never defined, so the Drawings, sheet-markup and modification screens fell back to a second, light-theme palette (`#cbd5e1` borders on dark UI) | `styles.css` lines 1071–1438 (original) | ✅ M1 |
| D2 | Five different blues for "accent": `#4aa8ff`, `#2563eb`, `#2f80ed`, `#3b82f6`, `#2a78d6` | same | ✅ M1 (screen UI; paper drawings keep theirs) |
| D3 | `.seg` (segmented control) declared twice; the second silently overrode the first | lines 159 and 1071 (original) | ✅ M1 |
| D4 | Native scrollbars and checkboxes drawn light on the dark UI (no `color-scheme`) | before/after screenshots | ✅ M1 |
| D5 | No light theme; dark only | — | ✅ M1 |
| D6 | 17 dialogs build their own `.modal-backdrop` instead of the shared `<Modal>`, so Escape-to-close and dialog stacking differ between dialogs | `grep 'className="modal-backdrop"'` | M3 |
| D7 | 93 native `confirm()` / `alert()` / `prompt()` calls: unstyled, block the window, and can't show detail | `grep` | M3 |

## 4. Inconsistencies (not defects)

- **Type scale.** 12 font sizes in CSS (9, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 18 px) against 3 tokens (`--fs-xs/sm/md`). Half-pixel sizes (11.5, 12.5, 13.5) blur on non-retina Windows screens.
- **Buttons.** One main family (`.chip`, 525 uses) plus `.link` (59), `.linkish` (56), `.icon-btn` (102), and a separate primary style in `.tool-panel button.primary`.
- **Icons.** Lucide icons in the ribbon, Unicode glyphs elsewhere (▶ Run, ⚠ banners, ✕ close). They render at different weights.
- **Inline styles.** 413 `style={{}}` blocks; the worst are `SystemDiagram.tsx` (30), `DesignReferencesView.tsx` (21), `SubmissionsView.tsx` (17). Most are one-off spacing that should be utility classes.
- **Shadows.** Seven shadow recipes for the same "floating menu" role. Unified in M1.

## 5. What is already good (keep)

- A 4 px spacing grid, control heights and radii as tokens.
- Form-control edges were deliberately set to ≥3:1 contrast (WCAG non-text). Kept and extended to light.
- Tabular figures app-wide, right-aligned numeric columns, units never uppercased in table headers.
- Focus rings on buttons, inputs and SLD symbols; Escape-stack handling in the shared `<Modal>`.
- Status always carries a word (pass / warning / fail), not colour alone.
- Exports convert the screen palette to black-on-white print colours instead of printing the dark UI.

## 6. Reusable components that already exist

`src/components/ui.tsx`: `Page`, `Modal`, `StatusCell`, `StatusCounts`, `StaleBanner`, `NumberSetting`, `NumField`, `FocusChip`; `grid/ClassicGrid` + `useExcelGrid` (Excel-style editing); `EditCell`; `MenuButton`; `CommandPalette`. The plan builds on these rather than adding new ones.

## 7. Baseline screenshots

Captured from the built app (sample project "Explore sample") in Electron, 1440 × 900, under a virtual display. See `docs/UI-TEST-RESULTS.md` for the method and the before/after comparison. The screenshots themselves are kept out of the repository (about 2 MB each); regenerate them with the steps in that file.
