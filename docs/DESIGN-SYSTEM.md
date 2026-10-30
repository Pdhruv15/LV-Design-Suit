# Design system — LV Design Studio

Tokens live in **`src/theme/tokens.css`** (loaded before `src/styles.css`). Figma mirror: [LV Design Suite — Design System](https://www.figma.com/design/QbuEPgIWcPo129tBQDwjhX); see `FIGMA-INTEGRATION.md`.

Principles, for engineering software used for hours at a time:

1. **Data first.** Chrome stays quiet; numbers, statuses and drawings carry the colour.
2. **Dense but legible.** 32 px rows and controls, 13 px body text, tabular figures.
3. **Status is never colour alone.** Always a word or symbol plus colour (✓ Pass, ! Warning, ✕ Fail).
4. **No decorative motion.** Transitions only on hover/press feedback (≤120 ms).
5. **Exports are not themed.** Drawings, PDF and DXF are always black-on-white.

## Colour tokens

| Token | Role | Dark | Light |
|---|---|---|---|
| `--bg` | page background behind panels | `#0B1A2A` | `#F4F6F9` |
| `--panel` | header, sidebar, cards, dialogs | `#0F2A44` | `#ffffff` |
| `--p2` | raised: inputs, chips, hover rows | `#122E4A` | `#EEF2F6` |
| `--line` / `--line-strong` | dividers / hover edges | `#234563` / `#33597C` | `#D8DFE6` / `#BCC7D2` |
| `--field-line` | form control edge (≥3:1) | `#5F86A8` | `#7A8A9A` |
| `--tx` / `--mut` | text / secondary text | `#E3EAF2` / `#9FB3C8` | `#0F2A44` / `#51667A` |
| `--acc` / `--on-acc` | primary action, selection, focus / text on it | `#F5B301` / `#0F2A44` | `#0F2A44` / `#ffffff` |
| `--ok` `--warn` `--bad` | pass / check / fail | `#37d67a` `#f5c04a` `#ff5d6c` | `#177336` `#8a5d00` `#cf222e` |
| `--bus` | SLD busbars, board group labels | `#ffb347` | `#a64b07` |
| `--res-cur` `--res-fault` `--res-pf` | SLD result labels | | |
| `--ph-r` `--ph-y` `--ph-b` `--ph-ryb` | phase colours | | |
| `--canvas-bg` `--canvas-ink` `--canvas-grid` `--canvas-grid-major` | the one drawing surface: SLD, riser, earthing, lux plan, Design CAD | `--bg`, `--tx`, `#16223a`, `--line` | `--bg`, `--tx`, `#e8eaef`, `--line` |
| `--pit-pass` `--pit-fail` `--pit-untested` | earth pit test status | mixes of `--ok`, `--bad`, `--mut` | |
| `--curve-1` … `--curve-8` | chart series (protection curves) | original curve colours | darker, ≥ 4.8:1 on white |
| `--backdrop`, `--shadow-pop`, `--shadow-modal`, `--shadow-palette`, `--shadow-paper`, `--shadow-drawer`, `--shadow-side`, `--row-sub` | overlays and elevation | | |

**Light theme (v2, Oct 2026):** neutral cool greys, body text about 15:1 rather than near-black, status colours close to common GitHub/Fluent values. Proposal frame: Figma *Screens* page, "Light theme v2 (proposal)".

**Contrast** (checked by `src/theme/tokens.test.ts` on every test run): all text tokens are ≥4.5:1 on `--bg`, `--panel` and `--p2` in both themes; `--field-line` is ≥3:1 on `--panel` and `--p2`.

**Do not** use `#fff`, `#000` or hex colours for screen UI. White and black remain correct for *paper* (drawing sheets, title-block previews, logo previews), which are white in both themes on purpose. `tokens.test.ts` lists the stylesheet rules and components allowed fixed colours and fails on a new one.

**Drawings on screen** use the `--canvas-*` tokens, so every drawing has the same background and grid. Design CAD shows a DWG colour under 3:1 against the canvas lighter (dark theme) or darker (light theme) with the same hue, and yellow as gold (`src/model/cadDraw.ts`, `screenColour`). Saved DWG, DXF and PDF keep the stored colours.

Legacy names `--border`, `--accent`, `--fg`, `--muted` are aliases kept so older rules resolve; use `--line`, `--acc`, `--tx`, `--mut` in new CSS.

## Spacing, size, radius, type

| Token | Value | Use |
|---|---|---|
| `--space-1…5` | 4, 8, 12, 16, 24 px | all padding and gaps |
| `--gutter` | 16 px | page side padding |
| `--control-h` / `--control-h-sm` | 32 / 26 px | buttons, inputs, tabs / in-table buttons |
| `--radius-sm/md/lg` | 6 / 9 / 12 px | controls / cards / dialogs |
| `--fs-xs/sm/md` | 11 / 12 / 13 px | captions & table headers / secondary / body |

Headings: page 18 px semibold (`.stage-head h3`), dialog 16 px, card 13 px semibold. No new font sizes and no half-pixel sizes in screen UI. Drawing text (SVG) keeps its own sizes: exports copy them.

## Components (existing classes, now on tokens)

| Component | Markup | Rules |
|---|---|---|
| Button | `button.chip` | Secondary by default. `.chip.primary` once per view and last in a dialog. `.chip.bad-btn` for destructive actions. `.chip.sm` inside tables. |
| Segmented control | `.seg > button(.on)` | 2–4 mutually exclusive views. One definition (was two). |
| Tabs | `.tabs > button(.on)` | accent text + 2 px underline |
| Ribbon | `<Ribbon>` | every group has a caption (`CAPTIONS`, tested); selected tab is a solid fill (light theme: the tab takes the tool-strip colour with a 2 px accent top edge, and the active tool is an accent tint, so there are no large solid-blue blocks on white); the project's current stage is a `.stage-now` badge, never a fill. Two selected looks, one meaning each: **`.on` = an active tool or mode** (Select, Pan — filled; `aria-pressed`), **`.page-on` = the page you are on** (SLD, Schedule — tab look: accent text + 2 px underline, no fill; `aria-current="page"`) |
| Icons in chrome | `lucide-react` | no Unicode glyphs (▾ ● ⚠ ✕ ✓ ▶) as icons; state in words beside the icon (`sub: 'unsaved'`) |
| Input / select | plain `input`, `select` | base style is zero-specificity (`:where`) so grids stay compact; full height inside `.modal`, `.form-kv`, toolbars |
| Number with unit | `<NumField>` (`ui.tsx`) | commits on Enter/blur; unit shown after the box |
| Dialog | `<Modal>` (`ui.tsx`) | Escape closes the top dialog only; backdrop click closes (`closeOnBackdrop={false}` for long tasks); focus is trapped inside and returns to the opener; actions bottom-right, primary last (`.modal-actions`). Never build `.modal-backdrop` by hand |
| Confirm / notice | `await ask('Delete MDB-1? Detail…')`, `tell(title, message)` (`ConfirmDialog.tsx`) | never `window.confirm/alert`. The first question is the title, the rest the detail; delete/remove/replace/… make a red button named after the action, focus on Cancel |
| Text input | `await askText(title, { label, required, multiline, options })`, `await askForm({ title, fields })` | never `window.prompt`; several questions = one form; null when cancelled |
| Validated number | `<CheckedNum rule={{ min, max, unit }}>`, `checkNumber()` | message under the field in words, `--bad` edge, nothing saved or clamped until it is valid |
| Page | `<Page title intro actions>` | every study/document page |
| Status | `<StatusCell>`, `<StatusCounts>`, `.ok/.warn/.bad` | word + colour |
| Stale results | `<StaleBanner>` | inputs changed since the last run |
| Table | plain `table`; `th.num`/`td.num` right-aligned; `tr.sel` selected; `tr.total` | 32 px rows everywhere (also `.gx`, `.schedule`, `.compact`), 11 px semibold headers in written case — never uppercase (units) |
| Wide schedule | `<div className="table-scroll"><table>` | header row and first column sticky; the box scrolls, not the page |
| Study summary | `<ResultCards><ResultCard label value status sub onClick>` | worst case first, then limit / counts; status = colour + word; click goes to the worst item; caption (`.dash-label`) in written case, never uppercase |
| Export | `<ExportBar scope revision blocked lead>` + format buttons | scope, revision, save to, formats; one primary, last; blocked reason in words |
| Report preview | `<PaperPreview html title>` | paper size and margins from the report's own `@page`; dashed margin guides; never edits the exported HTML |

Figma has matching component sets for Button, Input, Status badge, Tab, Nav item and Table cell.

## Theme switching

`Preferences → Appearance & saving → Colour theme`: **Dark** (default), **Light**, **Match system**. Stored in `lvds.preferences.app.theme` on this computer. It is not part of the project file, so sharing a project never changes a colleague's theme.

`src/theme/theme.ts` sets `<html data-theme="light">` (dark = no attribute). `withPrintTheme()` wraps export code so `printableSvg()` always reads dark-palette colours and maps them to print colours. Exported SVG/PDF/DXF are byte-identical in either theme (verified, see `UI-TEST-RESULTS.md`).

## Accessibility checklist for new UI

- [ ] Keyboard reachable; visible `:focus-visible` ring (2 px `--acc`)
- [ ] Dialogs through `<Modal>` (Escape closes the top one, focus trapped and returned)
- [ ] Icon-only buttons have `title` and `aria-label`
- [ ] Errors next to the field, in words, with `--bad`; not colour alone
- [ ] Checked in both themes
