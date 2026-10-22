# UI / UX enhancements — 2026-10-22

Done in branch `ui/light-theme-refresh` (light theme v2): neutral cool greys, softer body text, standard status colours, tinted ribbon selection in light, softer voltage-drop bars, no colour fade when switching theme. Figma: *Screens* page → "Light theme v2 (proposal)".

Next candidates — done in v1.72 (branch `ui/readability-polish`):

- ~~**Two "selected" looks in the ribbon.** SLD (current page, `page-on`) and Select (active tool, `.on`) sit side by side with different styles. Decide one meaning per style and document it.~~ — filled = active tool or mode (`.on`), underline without fill = current page (`.page-on`); in DESIGN-SYSTEM.md.
- ~~**Result card captions in capitals** (WORST VOLTAGE DROP, LIMIT…). DESIGN-SYSTEM.md says written case for table headers; apply the same to cards for consistency.~~ — `.dash-label` written case; in DESIGN-SYSTEM.md.
- ~~**Long names cut off** in the board properties panel (`Main Distribution Boa…`) and in the voltage-drop chart labels: show the full name on hover, or let the side panel be resized.~~ — full text on hover (board name/type, chart labels); the side panel was already resizable.
- ~~**SLD at 100 % is too small to read** on open in the sample project: open at "fit width" with text at least 10 px on screen.~~ — opens at 1 px per drawing unit (text 10–12 px), from the top, centred on the main board; fit width when that is readable.
- ~~**Light-theme check of every screen** (Documents, BOM, Standards, dialogs) against the new palette; only Overview, Voltage drop and SLD were checked.~~ — every page and dialog scanned (no dark panels, no text under 3:1); found and fixed the settings dialog tab overlapping its footnote.
- Sync the Figma `Theme/Light` variables to the v2 values after the branch merges (writes are free; Starter plan allows only 3 pages, so new frames go on *Screens*).
