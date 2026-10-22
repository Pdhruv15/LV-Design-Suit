# UI implementation plan

Small, separately tested milestones on branch `ui/design-system`. No rebuild, no new dependencies, no changes to calculations, standards or the project file format. Each milestone ends with typecheck, lint, the full unit suite, the PDF/DXF suite in Electron, and before/after screenshots (`UI-TEST-RESULTS.md`).

| # | Milestone | Status |
|---|---|---|
| 1 | Design tokens, light/dark theme, colour defects D1–D4 | ✅ done, verified |
| 2 | Header, ribbon, sidebar and navigation | ✅ done, verified |
| 3 | Forms, buttons, dialogs, validation | ✅ done, verified |
| 4 | Engineering tables and result displays | ✅ done, verified |
| 5 | SLD editor interface | ✅ done, verified |
| 6 | Report preview and export interface | ✅ done, verified |
| 7 | Final consistency review (both themes, every screen) | ✅ done, verified |

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

**Follow-up, done after milestone 7:** all 28 `window.prompt()` calls (8 files) replaced by `askForm()` / `askText()` (`ConfirmDialog.tsx`): an in-app form with labelled fields, "(optional)" marked, required fields blocked with "Required" under the field, text areas where text can run to several lines (Ctrl+Enter / ⌘Enter saves), and choice lists. Chains of prompts became one form each: new modification (title, why, origin), record draft changes, accept / reject / supersede (decider, reason, evidence), add a reference, reviewer decision (name, decision, conditions), withdraw / reopen / close a review comment. "Apply which template" is now a list to pick from instead of typing a name. Markup notes and callouts take real new lines (| still works). Cancel / Escape behave as prompt()'s Cancel did. One native `alert()` remains, in `model/projectStore.ts` (model code).

**Still open:** `<NumField>` elsewhere clamps out-of-range values silently; moving it to `checkNumber()` is the next validation step.

## 4 — Tables and results ✅

- One density: 32 px rows in `ClassicGrid` (`.gx`, was 28 px), `table.schedule`, `table.compact` and the BOQ tables, padding on the spacing tokens. `.gx` headers no longer forced to UPPERCASE (it turned mm² into MM² and kA into KA). The DEWA load schedule (`table.ls`) keeps its form-like density on purpose.
- `.table-scroll`: header row and first column stay in view while scrolling either way. Used by the schedules on the Documents tab (cable schedule, equipment), the BOQ bill and the per-circuit cost table.
- `<ResultCards>` / `<ResultCard>` (`ui.tsx`): one summary-card pattern; a status shows as coloured value **plus its word** (PASS / WARNING / FAIL). Voltage drop moved onto it (its worst-case card was colour only before). New cards, from results already calculated, on Earthing (worst loop impedance, results, source data, protective conductors), Selection (results, failing now, changes recommended) and Coordination (breaker pairs, overload ratio under 1.6, partial short-circuit selectivity, busbar fault level). The pass/warning/fail counts moved from the page header into a Results card on these screens. PFC and containment calculators use the same grid.
- Utility classes `u-flush`, `u-mb-2`, `u-mb-3` replace the repeated margins in `DesignReferencesView`. Not done on purpose: `SystemDiagram.tsx` inline styles are SVG drawing text sizes that exports copy, and the remaining inline widths are one-offs.
- "◀ Hide cable list / ▶ Choose cables" glyphs on Voltage drop replaced with Lucide icons.

## 5 — SLD editor ✅

- Canvas toolbar in two labelled groups, **Drawing** (IEC / Icons, DEWA, Cable no., Text) and **View** (grid, zoom out, zoom level, zoom in, fit, full screen), on a panel so it reads over the drawing. Every button has a tooltip; toggles report `aria-pressed`; glyphs (▦ ⁙ □ ⤢ ✕) replaced with Lucide icons.
- Visible zoom level (100 % = whole drawing fitted; click it to fit). Keyboard on the focused drawing: + / − zoom, 0 fit, arrow keys pan 10 %, Esc leaves full screen. Listed in the ? shortcut list and in a new **Keyboard shortcuts** section on the Help page (same data, so they cannot drift apart).
- Equipment palette: search and Recently used already existed; group headers are now buttons with `aria-expanded` (were clickable headings, not keyboard reachable), the search box is labelled and Escape clears it, delete buttons use icons with labels.
- Board properties: a heading over each field group when a tab shows several (General, Incomer & protection, Location & make; On the SLD keeps its own framed legend); one label column width in the inspector so fields line up across tabs; `.pn h4` on the type scale.
- SLD results bar: ⚠ / ✓ / ✕ replaced with icons (the words stay).
- **Export safety fix found during this milestone:** the SLD export, drawing sheets and study reports picked the drawing with `.sysdiag svg` (the first SVG in the diagram). With icons in the toolbar that would have exported an icon. The lookups now use `.sysdiag > svg` (the drawing is the diagram's direct child, also in the riser diagrams), the matching CSS rules too, and `SystemDiagram.export.test.tsx` renders the real SLD and fails if the export selector can reach a toolbar icon.

## 6 — Reports and export ✅

- `<ExportBar>` (`ui.tsx`): one export strip — **Scope**, **Revision** (what is printed on the documents), **Save to** (desktop: you choose the folder; browser: download / print dialog), then the formats with the primary last. Why export is blocked is written out, not only in a tooltip. Used by Study reports, Export centre, SLD export and the Calculation report. The forms behind them (studies, boards, title-block fields) stay where they were: rebuilding them into one form would risk what they export.
- Export centre had two primary buttons; Zip of PDFs is now secondary, One PDF primary. SLD export: the disabled Revision box moved into the strip.
- `<PaperPreview>` (`PaperPreview.tsx`): the report on its own paper size at true proportions, scaled to fit, with dashed page-margin guides and a label (e.g. "A4 landscape · margins 21 / 14 / 16 / 16 mm"). Size and margins are read from the report's own last unnamed `@page` rule, as the printer applies it, so the preview cannot disagree with the PDF. Only the preview copy gets the margins as screen padding; the exported HTML is unchanged (tested). Used by Study reports and the Calculation report. Paper is white in both themes.

## 7 — Final consistency review ✅

A scripted tour of the running app opened **every screen in both themes** (46 per theme: every page on every ribbon tab, the four SLD views, quick calculators, projects home) and checked each for text contrast against its real background (WCAG AA, opacity included), glyph icons in buttons, hard-coded colours in screen UI and page overflow. Fixed:

- **Glyph icons:** 43 ✕ remove / close buttons in 27 files → Lucide X with a label (from the button's tooltip, else "Remove"); arrow toggles (▸ ▾ ◀ ▶ ◂) → chevrons with `aria-expanded`; BOQ ✎ → pencil icon (help text now says "the pencil button"). The ✓ ! ✕ marks in check lists stay: there they are status symbols next to words.
- **Contrast:** BOQ "by others" rows were faded with opacity (2.9:1) → secondary text colour; BOQ edit buttons no longer half-transparent; New project card subtitle, quick-calculator labels lifted. Light theme: `--bus` #b45309 → #a64b07 (group labels in grids and voltage drop), `--ok` #137535 → #116b30 (PASS on selected rows), `--mut` #56657e → #505f77; earth pit badge text follows the theme. Dark values unchanged.
- **Protection chart:** curve colours were fixed hex values, pale on the light chart; now theme tokens `--curve-1…8` (dark = the original colours, light ≥ 4.8:1 on white).
- **Ribbon at 1440 px:** Detailed design was 24 px and BOM / Cost 103 px too wide; buttons 56 px min (was 62) with 6 px side padding, and "Bill of quantities" is "BOQ" on the ribbon (full name in the tooltip). Every tab now fits at 1440 px; narrower windows scroll the ribbon as before.

After the fixes the tour finds nothing in either theme except the protection legend swatches, which are the curve colours themselves (now tokens).

## Decisions needing the owner

None open. Light is opt-in and dark stays the default, so existing users see no change unless they choose Light.
