# UI implementation plan

Small, separately tested milestones on branch `ui/design-system`. No rebuild, no new dependencies, no changes to calculations, standards or the project file format. Each milestone ends with typecheck, lint, the full unit suite, the PDF/DXF suite in Electron, and before/after screenshots (`UI-TEST-RESULTS.md`).

| # | Milestone | Status |
|---|---|---|
| 1 | Design tokens, light/dark theme, colour defects D1–D4 | ✅ done, verified |
| 2 | Header, ribbon, sidebar and navigation | next |
| 3 | Forms, buttons, dialogs, validation | planned |
| 4 | Engineering tables and result displays | planned |
| 5 | SLD editor interface | planned |
| 6 | Report preview and export interface | planned |
| 7 | Final consistency review (both themes, every screen) | planned |

## 1 — Tokens and theme ✅

- `src/theme/tokens.css`: all colour, spacing, size, radius and type tokens; dark values identical to v1.68; light palette (WCAG AA).
- `src/theme/theme.ts`: Dark / Light / Match system; `withPrintTheme()` keeps exports identical.
- Preferences: *Appearance & saving → Colour theme*.
- `styles.css`: 68 hard-coded colours/shadows replaced by tokens; undefined variables fixed; duplicate `.seg` merged; `color-scheme` so scrollbars and checkboxes follow the theme.
- Figma file with matching variables, components and a two-theme screen preview.

## 2 — Header, ribbon, navigation

- Header: one row at ≥1200 px (profile chip currently wraps to a second row and costs 40 px of height on every screen).
- Ribbon: consistent group captions and disabled states; keyboard arrow-key movement between ribbon tabs (`role=tablist` semantics).
- Active stage clearly distinguished from the "now" stage marker.
- Replace Unicode glyph icons in chrome with the Lucide set already in use (`lucide-react`, no new dependency).

## 3 — Forms, buttons, dialogs, validation

- Move the 17 hand-built dialogs onto `<Modal>` (D6); add focus trap and return focus to the opener.
- Replace native `confirm()`/`alert()` (D7) with a `<ConfirmDialog>` built on `<Modal>`, prioritising destructive actions (delete board, overwrite) first. 93 call sites, done incrementally.
- Type scale: retire half-pixel sizes; map to `--fs-*`.
- Inline field validation pattern (message under the field, `--bad`, words), starting with Load assessment and Voltage drop inputs.

## 4 — Tables and results

- One table density (32 px rows) across `ClassicGrid`, `table.schedule`, `table.compact`.
- Sticky header row and first column for wide schedules (BOQ, cable schedule).
- Result summary cards in one pattern (worst case, limit, pass/warn/fail counts), as in the Voltage drop screen.
- Move the most-repeated inline styles to utility classes, starting with `SystemDiagram.tsx`, `DesignReferencesView.tsx`, `SubmissionsView.tsx`.

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
