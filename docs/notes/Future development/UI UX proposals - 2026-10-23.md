# UI / UX proposals — 2026-10-23

## Equipment palette: icon tiles instead of accordion lists

Approved and done 2026-10-23: category tiles (Boards = distribution boards + package panels, Cable = cable + cable types), ribbon-style item tiles with SLD-like symbols and drop-target dots, a pinned favourites / recently used strip, a hover card, and click-to-place (click a tile, then click the drawing; shift-click places another; Esc cancels) with × qty on the armed tile. The collapsed rail (7) is not built. Mockup: `docs/mockups/equipment-palette-icons-mockup.html`. As proposed:

Today the Equipment tab is 13 collapsible text rows (Recently used, Feeder presets, My presets, My components, Supply, Distribution boards, Package panels, Protection, Metering & accessories, Cable types, Motor starters, Cable, Loads). Finding an item means opening a group, scrolling past the ones above it, and reading names; the only picture of what an item is comes from the small lucide icon. Proposal:

1. **Category tiles.** Replace the accordion with a 4 × 3 grid of icon tiles (symbol + short label + count): Supply, Boards (DBs and package panels merged), Protection, Metering, Cable (cable + cable types merged), Starters, Loads, Presets, My presets, My components, My equipment. One category open at a time; its items show below as a 3-column icon grid, so the list never exceeds one screen.
2. **Item tiles.** Symbol drawn like the SLD symbol it becomes (transformer circles, board rectangle with busbar, breaker, motor M, fan…), name, and a second line with the size where useful (45 kW, 6 × In). Feeder presets keep their two-line card (breaker · cable · length), full width.
3. **Favourites and recently used** as one pinned strip of small tiles under the search, always visible, replacing the two collapsible groups.
4. **Click to place.** Clicking a tile arms it (highlighted, with a × qty stepper on the tile); the next click on a busbar, feeder or canvas places it; Esc disarms; shift-click arms × 3. Drag and drop stays as it is. Replaces the "Drop N at a time" field.
5. **Where-it-drops dots** on each tile (blue busbar, green feeder, amber empty canvas) and the same words in the hover card, replacing the three-line instruction paragraph.
6. **Hover card** showing the full description (today only a native tooltip): name, size, what is added, where it drops, click / shift-click hints.
7. **Collapsed rail (optional, later).** When the side panel is hidden, a 46 px icon rail with a flyout per category, as in CAD tool palettes, so the canvas keeps its width.

Unchanged: colours, fonts, panel width, search box, tab strip, ★ on hover, edit / copy / delete on presets and components, + / import / export tools, all drop behaviour on the SLD. Group names in `src/model/sldEdit.ts` and the palette preferences keys stay, so saved favourites and collapsed state carry over.

Implementation scope if approved: `src/components/EquipmentPalette.tsx` (layout and arm-to-place state), a small symbol set in `src/components/` reused from the SLD symbol drawing, `src/styles.css` (new `.palette-cat` / `.palette-tile` rules, existing tokens only), and the SLD canvas accepting a click while a tile is armed, in addition to drop.
