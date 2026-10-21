# UI implementation plan

Small, separately tested milestones on branch `ui/design-system`. No rebuild, no new dependencies, no changes to calculations, standards or the project file format. Each milestone ends with typecheck, lint, the full unit suite, the PDF/DXF suite in Electron, and before/after screenshots (`UI-TEST-RESULTS.md`).

| # | Milestone | Status |
|---|---|---|
| 1 | Design tokens, light/dark theme, colour defects D1–D4 | ✅ done, verified |
| 2 | Header, ribbon, sidebar and navigation | ✅ done, verified |
| 3 | Forms, buttons, dialogs, validation | ✅ done, verified |
| 4 | Engineering tables and result displays | ✅ done, verified |
| 5 | SLD editor interface | next |
| 6 | Report preview and export interface | planned |
| 7 | Final consistency review (both themes, every screen) | planned |

## 1 — Tokens and theme ✅

- `src/theme/tokens.css`: all colour, spacing, size, radius and type tokens; dark values identical to v1.68; light palette (WCAG AA).
- `src/theme/theme.ts`: Dark / Light / Match system; `withPrintTheme()` keeps exports identical.
- Preferences: *Appearance & saving → Colour theme*.
- `styles.css`: 68 hard-coded colours/shadows replaced by tokens; undefined variables fixed; duplicate `.seg` merged; `color-scheme` so scrollbars and checkboxes follow the theme.
- Figma file with matching variables, components and a two-theme screen preview.

## 2 — Header, ribbon, navigation ✅

- Header: one row at ≥1200 px (89 → 49 px at 1280 px). The project name and the status message shorten with an ellipsis (full text in the tooltip); below 1200 px it wraps as before.
- Ribbon: every group on every tab has a caption (BOM / Cost, Standards, Recent and More had none); captions and sub-labels on `--fs-xs`. Arrow keys, Home and End already moved between tabs; tabs now also point at the tools with `aria-controls`.
- Current design stage: a green outlined **Now** badge instead of muted "· now" text, which was low-contrast on the selected (solid) tab. Selected tab = solid fill; current stage = badge.
- Unicode glyphs in chrome replaced with Lucide icons: split-button and menu arrows (▾), status bar (⚠ ✓ ▶), close buttons (✕), offline-ready (✓). Unsaved changes: a CSS dot plus the word "unsaved" under Save; database issues: "n to check" under Database (was "(n ⚠)").
- `src/components/Ribbon.test.tsx` guards captions, the no-glyph rule, the stage badge and tab/tool linkage.
- Left for later milestones: glyphs in the SLD results bar (`DiagramResultsBar`, M5) and in `<StaleBanner>` (M3).

## 3 — Forms, buttons, dialogs, validation ✅

- `<Modal>`: focus moves into the dialog (an `autoFocus` field wins), Tab and Shift+Tab stay inside it (visible controls only), and closing returns focus to the opener. New props `labelledBy`, `boxRef`, `backdropClassName`, `closeOnBackdrop` (false for the Build hierarchy wizard).
- All **27** hand-built dialogs (D6; the audit counted 17 files) now use `<Modal>`: the CAD import dialogs, SLD export, sheet workspace, standard loads, building reuse / design panels, row and circuit editors, drawing preview, command palette, keyboard help and Build hierarchy (its own trap and Escape handler removed). No `modal-backdrop` is built by hand any more.
- `<ConfirmDialog>` with `ask()` / `tell()` (`src/components/ConfirmDialog.tsx`, host mounted once in `App`): replaces **all 64** `confirm()` / `alert()` calls in the UI (D7). Destructive questions (delete, remove, clear, replace, overwrite, discard…) get a red action button named after the action and start with focus on Cancel. One `alert()` stays in `model/projectStore.ts` (model code must not import UI); it reports a damaged file that was recovered from its backup.
- Fixed while converting: the study-report pre-export check would have stopped blocking export once it became asynchronous; all four exports now wait for the answer.
- Type scale: 82 half-pixel font sizes in screen rules mapped to `--fs-xs/sm/md` (10.5 → 11, 11.5 and 12.5 → 12, 13.5 → 13). **Drawing text is untouched** (`.sysdiag`, SVG `text`, voltage-drop profile labels, cable refs, inline SVG sizes) because `printableSvg()` copies computed font sizes into exported drawings. The 7.5–9.5 px badge sizes are not half-steps of the scale and stay.
- Inline validation: `checkNumber()` and `<CheckedNum>` (`ui.tsx`). Bad input stays in the box, the edge turns `--bad`, a message in words sits under it ("Enter 0 to 100 %"), and nothing is saved until it is fixed; Escape restores the saved value. Applied to Load assessment (every number cell; GFA and VA/m² 0 or more, generator share 0–100 %) and Voltage drop (limit more than 0 %, custom conductor temperature −20 to 250 °C, the ranges the code already accepted). Previously bad input was silently ignored while the box kept showing it.
- Last glyphs in `ui.tsx` (`<StaleBanner>` ▶, `<FocusChip>` ✕) replaced with Lucide icons.

**Left for later (follow-up):** 28 `window.prompt()` calls in 8 files (sheet markup text, sheet rename/number, modification and review records) need a text-input dialog, ideally small forms rather than chains of prompts. `<NumField>` elsewhere still clamps out-of-range values silently; moving it to `checkNumber()` is the next validation step.

## 4 — Tables and results ✅

- One density: 32 px rows in `ClassicGrid` (`.gx`, was 28 px), `table.schedule`, `table.compact` and the BOQ tables, padding on the spacing tokens. `.gx` headers no longer forced to UPPERCASE (it turned mm² into MM² and kA into KA). The DEWA load schedule (`table.ls`) keeps its form-like density on purpose.
- `.table-scroll`: header row and first column stay in view while scrolling either way. Used by the schedules on the Documents tab (cable schedule, equipment, DB schedule), the BOQ bill and the per-circuit cost table.
- `<ResultCards>` / `<ResultCard>` (`ui.tsx`): one summary-card pattern; a status shows as coloured value **plus its word** (PASS / WARNING / FAIL). Voltage drop moved onto it (its worst-case card was colour only before). New cards, from results already calculated, on Earthing (worst loop impedance, results, source data, protective conductors), Selection (results, failing now, changes recommended) and Coordination (breaker pairs, overload ratio under 1.6, partial short-circuit selectivity, busbar fault level). The pass/warning/fail counts moved from the page header into a Results card on these screens. PFC and containment calculators use the same grid.
- Utility classes `u-flush`, `u-mb-2`, `u-mb-3` replace the repeated margins in `DesignReferencesView`. Not done on purpose: `SystemDiagram.tsx` inline styles are SVG drawing text sizes that exports copy, and the remaining inline widths are one-offs.
- "◀ Hide cable list / ▶ Choose cables" glyphs on Voltage drop replaced with Lucide icons.

## 5 — SLD editor

- Group canvas tools (IEC / DEWA, cable no., text, zoom, fit, full screen) into one labelled toolbar with tooltips.
- Equipment palette: search, recently used.
- Properties panel: section headings, consistent field widths.
- Canvas: visible zoom level, keyboard pan/zoom documented in Help.

## 6 — Reports and export

- One export panel pattern (format, scope, revision, destination) shared by Study reports, Export centre and SLD export.
- Report preview frame consistent with paper size and margin guides.

## Decisions needing the owner

None open. Light is opt-in and dark stays the default, so existing users see no change unless they choose Light.
