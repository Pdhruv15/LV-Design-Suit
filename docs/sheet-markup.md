# Sheet markups (SLD sheets)

Added 5 October 2026. Every SLD, board and riser sheet has a **Markup** toolbar
above the page in the sheet view (not on the earthing schematic sheet yet).

Tools: revision cloud (with its revision triangle, default the sheet's next
revision), box, line, arrow, note and callout (boxed text with a leader arrow to
the point it refers to). Colours red, blue or black; note and callout letter
height 2.5, 3.5 or 5 mm. Select a markup to move it, drag a handle to resize or
re-aim it, press Delete to remove it, double-click to edit its text or the
cloud's revision. Side panel: list of the sheet's markups with remove / remove all.

Storage: `DrawingSheet.markups`, in **paper millimetres** (origin top-left). They
belong to the sheet, so changing the design never moves or removes them, and they
count as a change since the sheet was issued. They are not pinned to equipment.

Output: printed on the PDF (an SVG layer over the page) and written to the DXF as
editable polylines and `TEXT` on `E-MARKUP` (red), `E-MARKUP-BLUE` and
`E-MARKUP-BLACK`, above the diagram. Code: `src/model/sheetMarkup.ts`,
`src/components/sld/SheetMarkupLayer.tsx`.

Not yet: pinning markups to equipment, earthing sheet markups, per-sheet
hide / print switch.
