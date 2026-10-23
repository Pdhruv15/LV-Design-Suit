# Equipment palette icon-grid proposal — 2026-10-23

Status: proposal only; wait for approval before implementation.

Recommended compact mock-up: `docs/mockups/equipment-palette-icon-grid-compact-v2.png`

Original roomier mock-up: `docs/mockups/equipment-palette-icon-grid-proposal.png`

Interactive size-scaling sample: `docs/mockups/equipment-palette-size-scaling-mockup.html`

## Recommendation

Replace the long category accordion with a two-level, icon-first palette:

1. Keep search at the top and add a small Quick access row for Recent, Favourites, and commonly used equipment.
2. Show all equipment categories as large icon tiles. Selecting one category reveals its equipment below, so users do not need to repeatedly open and close dropdowns.
3. Show equipment as schematic-symbol tiles with short labels. Use the same symbol vocabulary as the SLD wherever possible.
4. Make click-to-place the primary action: selecting a tile arms it, the next valid canvas click places it, and Escape cancels. Keep drag-and-drop for precise positioning.
5. Put quantity controls on the armed tile rather than keeping a separate global “Drop N at a time” field.
6. Keep current colours, typography, tabs, search, favourites, recent history, preset tools, and underlying equipment data unchanged.

The compact version reduces outer padding, grid gaps, icon size, and tile height. It retains a 4–6 px separation between tiles rather than removing spacing completely, so adjacent click targets remain visually distinct.

The scaling sample demonstrates Compact (85%), Balanced (100%, recommended), and Large (115%) modes. Each mode scales icon size, label size, tile height, hit area, spacing, and column count together rather than applying browser zoom.

## Why this is easier to use

- Categories are recognizable by position and symbol instead of requiring text scanning.
- Common equipment is one click away through Quick access.
- Only one category's items are shown at a time, reducing vertical scrolling.
- The selected state clearly communicates what the next canvas click will do.
- Click-to-place is easier for occasional users, while drag-and-drop remains available for experienced users.

## Suggested interaction details

- Remember the last selected category.
- Show a clear blue outline for the selected category and armed equipment.
- Support keyboard navigation, Enter/Space to select, and Escape to cancel.
- Keep full equipment names and placement rules in accessible tooltips.
- On very narrow panels, keep a two-column equipment grid; categories can remain three columns.

## Approval gate

Before implementation, confirm whether Quick access should contain four fixed shortcuts as mocked up or be populated entirely from Recent and Favourites. No source, styling, wording, navigation, or interaction code is changed by this proposal.
