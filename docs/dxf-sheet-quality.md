# DXF sheet layout and completeness

Updated 4 October 2026.

Both the system-diagram export dialog and drawing-set exports now use the
same paper-sized DXF builder. Selecting A4, A3, A2 or A1 sets the actual
landscape sheet dimensions in millimetres. Output remains editable ASCII
AutoCAD R12 geometry on the `E-*` drawing layers.

All DXF text uses Roman Duplex (`ROMAND` / `romand.shx`) for stronger,
clearer lettering. The style name matches the font basename so LibreCAD
selects its bundled `romand.lff` instead of falling back to `standard`.
Labels, title blocks, schedules and continuation notes remain editable
`TEXT` entities with their original heights and fitted baseline widths.
The DXF contains vector text; visible stair-stepping at some zoom levels
still depends on the CAD viewer's screen rendering. Arial TrueType is not
used because it does not resolve to filled system-font text in LibreCAD.
SVG font-size attributes and inherited sizes are also honoured, preserving
the distinct heading, equipment, note and conductor sizes in earthing sheets.

Earthing drawings include a wrapped earth-pit schedule with equipment,
connection, earth system/substation, conductor, electrode and measured
resistance (`ohm` survives ASCII DXF). Untested pits are labelled `Not tested`.
The dedicated earth-pit PDF keeps its schedule as a paginating HTML table.
Pit IDs are persisted per equipment in `earthPitIds`; retired IDs are reserved,
and legacy readings keep their original numbering when a project is opened.

DXF retains visible gaps in earthing pit interconnections, incoming CPC
indications and dashed enclosures. Dash arrays from SVG attributes, inline
styles and inheritance are exported as editable polyline segments. Pattern
spacing continues around corners and scales with the drawing, including
nonuniform transforms; it does not rely on custom CAD linetype support.

Long title values and revision descriptions wrap within their cells.
Values that would require excessive compression appear as numbered entries
under `TITLE BLOCK DETAILS`, with a matching reference in the original cell.
Custom title templates retain their row/column dimensions, merged cells,
alignment, captions and project/sheet parameters. Raster logos remain in the
PDF; DXF reports when a logo is omitted or replaced by a placeholder.

The diagram has a reserved area beside the legend, cable schedule,
abbreviations and notes. Additional information flows into further columns
and continuation sheets at the same physical text size. Cable descriptions,
fire-rated markers, the fire note and all nonblank notes are preserved.
Ordinary schedule entries stay together; oversized paragraphs can continue.

A single-page export saves one DXF. When extra pages are needed, the export
saves a ZIP containing the main DXF and files named
`<drawing>_continuation_1.dxf`, etc. The main sheet points to its continuation
sheets, and each continuation identifies its source drawing and position.
Drawing-set and Everything ZIP exports include every continuation. Duplicate
drawing numbers receive unique filenames so ZIP entries cannot overwrite.
The save status reports continuation count and any readability/template
limitations.

## Verification

- Thirteen sheet regression cases cover A4–A1 bounds, 120 cable references,
  fire notes, abbreviations, long notes/titles/revisions, diagram clearance,
  custom grids, tiny/narrow cells, parameter overrides, viewBox origins and
  a paragraph near the continuation-column capacity.
- Three drawing-set integration cases check separate continuation files,
  sheet paper sizes and metadata, shared reference schedules, duplicate
  drawing numbers and a ZIP round trip.
- Existing busbar, feeder-label and curved-symbol regressions remain in place.
- Native LibreCAD checks covered an A3 standard sheet, its continuation with
  80 schedule entries plus notes, and an A1 custom title-block sheet. This
  verification used generated local samples; AutoCAD was not inspected.
- Native font comparisons checked the old fallback, Roman Simplex, Roman
  Duplex, Roman Triplex, ISO and Arial references. Roman Duplex was selected
  after confirming that its matching style name changes the displayed font.

PDF rendering is unchanged. DXF continuation pages are supplemental CAD
sheets and do not add drawing-register entries or additional PDF pages.
