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
| `--bg` | canvas, diagram background | `#0a1120` | `#f4f6fa` |
| `--panel` | header, sidebar, cards, dialogs | `#0f1a2f` | `#ffffff` |
| `--p2` | raised: inputs, chips, hover rows | `#14233f` | `#eef2f8` |
| `--line` / `--line-strong` | dividers / hover edges | `#20304f` / `#2f4570` | `#d5dce8` / `#b4c0d4` |
| `--field-line` | form control edge (≥3:1) | `#52709f` | `#74839c` |
| `--tx` / `--mut` | text / secondary text | `#dbe4f5` / `#8093b5` | `#142035` / `#56657e` |
| `--acc` / `--on-acc` | primary action, selection, focus / text on it | `#4aa8ff` / `#04101f` | `#1a66c9` / `#ffffff` |
| `--ok` `--warn` `--bad` | pass / check / fail | `#37d67a` `#f5c04a` `#ff5d6c` | `#137535` `#8f5606` `#c81e3a` |
| `--bus` | SLD busbars | `#ffb347` | `#b45309` |
| `--res-cur` `--res-fault` `--res-pf` | SLD result labels | | |
| `--ph-r` `--ph-y` `--ph-b` `--ph-ryb` | phase colours | | |
| `--backdrop`, `--shadow-pop`, `--shadow-modal`, `--shadow-palette`, `--shadow-paper`, `--row-sub` | overlays and elevation | | |

**Contrast** (checked by `src/theme/tokens.test.ts` on every test run): all text tokens are ≥4.5:1 on `--bg`, `--panel` and `--p2` in both themes; `--field-line` is ≥3:1 on `--panel` and `--p2`.

**Do not** use `#fff`, `#000` or hex colours for screen UI. White and black remain correct for *paper* (drawing sheets, title-block previews, logo previews), which are white in both themes on purpose.

Legacy names `--border`, `--accent`, `--fg`, `--muted` are aliases kept so older rules resolve; use `--line`, `--acc`, `--tx`, `--mut` in new CSS.

## Spacing, size, radius, type

| Token | Value | Use |
|---|---|---|
| `--space-1…5` | 4, 8, 12, 16, 24 px | all padding and gaps |
| `--gutter` | 16 px | page side padding |
| `--control-h` / `--control-h-sm` | 32 / 26 px | buttons, inputs, tabs / in-table buttons |
| `--radius-sm/md/lg` | 6 / 9 / 12 px | controls / cards / dialogs |
| `--fs-xs/sm/md` | 11 / 12 / 13 px | captions & table headers / secondary / body |

Headings: page 18 px semibold (`.stage-head h3`), dialog 16 px, card 13 px semibold. No new font sizes; half-pixel sizes (11.5, 12.5) are being retired (milestone 3).

## Components (existing classes, now on tokens)

| Component | Markup | Rules |
|---|---|---|
| Button | `button.chip` | Secondary by default. `.chip.primary` once per view and last in a dialog. `.chip.bad-btn` for destructive actions. `.chip.sm` inside tables. |
| Segmented control | `.seg > button(.on)` | 2–4 mutually exclusive views. One definition (was two). |
| Tabs | `.tabs > button(.on)` | accent text + 2 px underline |
| Input / select | plain `input`, `select` | base style is zero-specificity (`:where`) so grids stay compact; full height inside `.modal`, `.form-kv`, toolbars |
| Number with unit | `<NumField>` (`ui.tsx`) | commits on Enter/blur; unit shown after the box |
| Dialog | `<Modal>` (`ui.tsx`) | Escape closes the top dialog only; backdrop click closes; actions bottom-right, primary last (`.modal-actions`) |
| Page | `<Page title intro actions>` | every study/document page |
| Status | `<StatusCell>`, `<StatusCounts>`, `.ok/.warn/.bad` | word + colour |
| Stale results | `<StaleBanner>` | inputs changed since the last run |
| Table | plain `table`; `th.num`/`td.num` right-aligned; `tr.sel` selected; `tr.total` | 32 px rows, 11 px semibold headers in written case |

Figma has matching component sets for Button, Input, Status badge, Tab, Nav item and Table cell.

## Theme switching

`Preferences → Appearance & saving → Colour theme`: **Dark** (default), **Light**, **Match system**. Stored in `lvds.preferences.app.theme` on this computer. It is not part of the project file, so sharing a project never changes a colleague's theme.

`src/theme/theme.ts` sets `<html data-theme="light">` (dark = no attribute). `withPrintTheme()` wraps export code so `printableSvg()` always reads dark-palette colours and maps them to print colours. Exported SVG/PDF/DXF are byte-identical in either theme (verified, see `UI-TEST-RESULTS.md`).

## Accessibility checklist for new UI

- [ ] Keyboard reachable; visible `:focus-visible` ring (2 px `--acc`)
- [ ] Dialogs through `<Modal>` (Escape closes the top one; focus trapping is planned in milestone 3)
- [ ] Icon-only buttons have `title` and `aria-label`
- [ ] Errors next to the field, in words, with `--bad`; not colour alone
- [ ] Checked in both themes
