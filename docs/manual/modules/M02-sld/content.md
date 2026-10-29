# M02 - Single Line Diagram (SLD)

<a id="SLD-010"></a>
## Purpose and data flow

Use the SLD workspace to build and review the electrical supply network from the
source through main boards, sub-main boards, DBs, and major equipment.

The SLD is not a separate drawing database. It displays the same boards, feeders,
loads, breakers, cables, and calculations used by schedules, studies, reports,
and the BOQ.

<a id="SLD-020"></a>
## Before starting

Confirm:

1. The project voltage, frequency, ambient conditions, and calculation limits.
2. The transformer or supply arrangement.
3. Required panel IDs, types, ratings, levels, and locations.
4. Available cable lengths or preliminary estimates.
5. The normal and standby supply concept.
6. Title-block and project information needed for drawing issue.

<a id="SLD-030"></a>
## Interface overview

The SLD work area contains:

1. The panel tree on the left.
2. System, board, earthing, and riser view tabs.
3. The interactive drawing canvas.
4. Drawing and zoom controls.
5. Board properties or circuit results on the right.
6. System, bus, and feeder results below the SLD.

The drawing sheets are in **Design CAD > Sheets**. The **Sheets** button on the
ribbon opens them.

<a id="SLD-040"></a>
## Navigate the drawing

- Press **V** for the Select tool.
- Press **H** for the Pan tool.
- Scroll over the drawing to zoom at the pointer.
- Press **+** or **-** to zoom.
- Press **0** to fit the whole system diagram.
- Use the arrow keys to pan after focusing the drawing.
- Use **Text: Auto** for zoom-dependent detail or **Text: All** for all labels.
- Use the full-screen control when reviewing a large network.

Click a board or feeder to select it. Double-click it, or press **F2** when
focused, to edit it.

<a id="SLD-050"></a>
## Build the panel hierarchy

1. Select the board that will supply the new board.
2. Select **Boards**.
3. Enter the new board ID, name, type, and rating.
4. Confirm the supplying board.
5. Enter the incomer circuit ID, cable length, cores, size, breaker rating, and Icu.
6. Select **Add board**.

The app creates the downstream board and its incomer feeder together. Use
**Build hierarchy** to create several panels and connections in a batch.

To change an existing board's source, drag it onto the new parent in the panel
tree. Confirm the move, then check the incomer cable length.

<a id="SLD-060"></a>
## Add feeders and equipment

1. Select the supplying board.
2. Select **Add load** or choose a motor, solar PV, EV charger, or feeder cable
   from its menu.
3. Complete **General & load** with the circuit ID, name, type, connected load,
   demand factor, and power factor.
4. Identify essential, existing, standby, or generation equipment when applicable.
5. Complete **Cable** with length, cores, size, runs, installation method, type,
   and protective conductor.
6. Use **Suggest cable size** when automatic guidance is required.
7. Complete **Protection** and **Metering** as applicable.
8. Save the feeder.

The feeder summary shows design current, cable, protection, and total voltage
drop while editing.

<a id="SLD-070"></a>
## Edit and reconnect items

- Drag library equipment onto a valid busbar or feeder target.
- Drag an existing board, load, or incomer to another valid target to reconnect it.
- Use **Edit** or **F2** to change the selected item.
- Use **Delete** to remove the selected item after reviewing the confirmation.
- Use **Ctrl/Command+C** and **Ctrl/Command+V** to copy a board with everything
  below it and paste the branch under another board.

Deleting a board also removes its downstream network.

<a id="SLD-080"></a>
## Board properties

Use the right-side tabs to review:

- **General**: identity, type, rating, busbar, and SLD display options.
- **Supply**: transformer, upstream chain, incomer, fault level, and voltage drop.
- **Electrical**: voltage, fault level, power factor, and source.
- **Protection**: incomer device and protection checks.
- **Location**: building level, room, manufacturer, and installation information.

The loading section shows connected load, demand load, demand current, and the
percentage of the board rating in use.

<a id="SLD-090"></a>
## Run and review calculations

After changing electrical data, select **Run** or press **F5**.

Review:

- design current against breaker and cable capacity;
- total voltage drop;
- breaker Icu against calculated fault level;
- earth-fault performance and disconnection time;
- board and phase loading; and
- warnings or failed circuits in the results drawer.

Use **System summary**, **Bus voltages & loading**, and **Feeders on _panel_** to
review results. Correct the source data, then run calculations again.

<a id="SLD-100"></a>
## Operating and display controls

The diagram can show IEC symbols or simple icons, DEWA-style panel frames, cable
reference numbers, result layers, and different text detail levels.

Display choices help prepare and review drawings but do not replace electrical
validation. If the diagram shows calculated labels, run calculations before export.

<a id="SLD-110"></a>
## Create drawing sheets

The SLD is the full editable network. The controlled drawing sheets are in
**Design CAD > Sheets**: SLDs, risers, and the earthing schematic, earth riser, and
floor earthing sheets.

1. Select **Sheets** on the ribbon, or **Design CAD > Sheets**.
2. Select **+ New sheet** above the sheet list.
3. Choose **Panel and its branch** (pick the panel), **Empty sheet**, a riser or
   earthing option, or **Split all panels into sheets**.
4. Check the sheet title, number, paper size, panel allocation, cable labels,
   printed result layers, status, and revision.
5. Use **Side by side** to see the design with each sheet's panels outlined. Drag
   a panel onto another outline to move it to that sheet.

Right-click a sheet in the list to rename, renumber, duplicate, move, revise,
export, or delete it. Clouds, notes, and callouts are added with **Markup** on the
sheet.

<a id="SLD-120"></a>
## Export drawings

For a quick export of the complete system diagram, select **Export** on the SLD,
complete the title-block details, and export SVG, DXF, or PDF.

For a controlled drawing set, open **Reports > Drawings**. Preview the sheets and
export a combined PDF, PDF per sheet, DXF per sheet, a ZIP package, or the drawing
register.

<a id="SLD-130"></a>
## Validation and review

Before issuing drawings, confirm:

- every panel has the correct upstream source;
- panel and circuit IDs are unique and meaningful;
- incomer and feeder lengths are credible;
- load schedules and MD forms are complete;
- calculations are current;
- failed and warning checks have been resolved or documented;
- panels are allocated to the correct sheets;
- drawing numbers, titles, revisions, statuses, and title blocks are complete; and
- the exported files have been previewed.

<a id="SLD-140"></a>
## Troubleshooting

### Results are marked out of date

Press **F5** after the latest design change.

### A board is supplied from the wrong panel

Drag it to the correct parent in the panel tree, then review its incomer length.

### Detail disappears when zoomed out

Zoom in or switch from **Text: Auto** to **Text: All**.

### A drawing sheet is empty

Edit the sheet's panel selection or recreate it from **Panel and its branch** in **Design CAD > Sheets**.

### A DB's final circuits are not drawn individually

Open its load schedule. The system SLD represents DB final circuits with a summary;
use a DB circuit diagram sheet when individual circuits must be shown.

<a id="SLD-150"></a>
## Completion checklist

- [ ] Supply hierarchy complete
- [ ] Board properties complete
- [ ] Feeders and major equipment complete
- [ ] Cable and protection information reviewed
- [ ] Load schedules complete
- [ ] Calculations run and reviewed
- [ ] Drawing sheets allocated and previewed
- [ ] Drawing metadata complete
- [ ] Project saved
- [ ] Required drawing outputs generated

