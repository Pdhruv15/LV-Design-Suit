# UI / UX enhancements — 2026-10-22

Done in branch `ui/light-theme-refresh` (light theme v2): neutral cool greys, softer body text, standard status colours, tinted ribbon selection in light, softer voltage-drop bars, no colour fade when switching theme. Figma: *Screens* page → "Light theme v2 (proposal)".

Next candidates (not started):

- **Two "selected" looks in the ribbon.** SLD (current page, `page-on`) and Select (active tool, `.on`) sit side by side with different styles. Decide one meaning per style and document it.
- **Result card captions in capitals** (WORST VOLTAGE DROP, LIMIT…). DESIGN-SYSTEM.md says written case for table headers; apply the same to cards for consistency.
- **Long names cut off** in the board properties panel (`Main Distribution Boa…`) and in the voltage-drop chart labels: show the full name on hover, or let the side panel be resized.
- **SLD at 100 % is too small to read** on open in the sample project: open at "fit width" with text at least 10 px on screen.
- **Light-theme check of every screen** (Documents, BOM, Standards, dialogs) against the new palette; only Overview, Voltage drop and SLD were checked.
- Sync the Figma `Theme/Light` variables to the v2 values after the branch merges (writes are free; Starter plan allows only 3 pages, so new frames go on *Screens*).
