# LV Design Studio user manual: SLD and load schedule

For easier onboarding, use the visual PDF manuals first:

- [Load Schedule visual user manual](../output/pdf/LV-Design-Studio-Load-Schedule-Visual-User-Manual.pdf)
- [SLD visual user manual](../output/pdf/LV-Design-Studio-SLD-Visual-User-Manual.pdf)

The PDFs use numbered interface callouts and step-by-step illustrations. This page remains the detailed text reference.

The maintained modular sources are:

- [M01 - Load Schedule](manual/modules/M01-load-schedule/content.md)
- [M02 - Single Line Diagram](manual/modules/M02-sld/content.md)
- [Manual structure and update rules](manual/README.md)

This manual explains how to build, check, and export a single line diagram (SLD) and its associated load schedules in LV Design Studio. The instructions describe the controls available in the app as of 23 October 2026.

## 1. How the two work areas relate

The SLD and load schedule use the same project data.

- A board, feeder, circuit, load, breaker, or cable edited in one work area is updated everywhere it is used.
- A DB's final circuits are maintained in its load schedule. On the SLD, they are represented by a summary that refers to the DB load schedule.
- MDB, SMDB, MCC, and similar outgoing feeders appear on the connected-load and maximum-demand form.
- Live totals, including load schedule and authority-form totals, update as data changes.
- Network study results can become out of date after an edit. Select **Run** or press **F5** before reviewing or exporting calculated results.

Save the project regularly with **Ctrl+S** on Windows or **Command+S** on macOS. Use **Ctrl+Z** or **Command+Z** to undo an edit.

## 2. Before starting

Complete the following project information where it applies:

1. Open **Project setup > Project settings**.
2. Check the system voltage, ambient and ground conditions, voltage-drop limit, sizing targets, submission-form details, and load schedule settings.
3. Set the load schedule point columns and default watts per point. A project or individual DB can override the defaults.
4. Open **Project setup > Parameters** and **Title block** to complete drawing and submission information.
5. If using the equipment library, confirm that the required items are available in `Loads.xlsx` through the app database.

Important: a load schedule point type with no **WATT / UNIT** value contributes 0 W until a value is entered.

## 3. Build and edit the SLD

### 3.1 Open the SLD

Select **Detailed design > SLD**. The work area contains:

- the panel tree on the left;
- the system diagram in the centre;
- board properties or circuit results on the right; and
- collapsible system, bus, and feeder results below the SLD.

The drawing sheets are in **Design CAD > Sheets**. The **Sheets** button on the ribbon opens them.

Use **Command/Ctrl+1** to return to the system diagram. **Command/Ctrl+2**, **Command/Ctrl+3**, and **Command/Ctrl+4** open the board diagram, earthing view, and riser view respectively.

### 3.2 Navigate the diagram

- Select **Select** or press **V** to work with boards and feeders.
- Select **Pan** or press **H** to move around without selecting an item.
- Scroll over the drawing to zoom at the pointer.
- Use **+** and **-** to zoom, **0** to fit the whole diagram, and the arrow keys to pan after focusing the drawing.
- Select the percentage in the diagram toolbar to fit the whole drawing.
- Select the full-screen control to enlarge the SLD; press **Esc** to leave full screen.
- Use **Text: Auto** to hide detail progressively when zoomed out, or **Text: All** to keep all labels visible.
- Double-click the resize handle below the diagram to restore the default diagram height.

Selecting a board shows its properties. Selecting a feeder shows its circuit results. Double-click a board or feeder to edit it. In the panel tree, double-clicking a board opens it on the SLD, while right-clicking opens additional actions.

### 3.3 Add a downstream board

1. Select the board that will supply the new board.
2. Select **Boards**.
3. Enter the board ID and name.
4. Choose the board type and rated current.
5. Confirm **Fed from** and enter the incomer circuit ID.
6. Enter the cable length, cores, cable size, breaker rating, and breaker Icu.
7. Select **Add board**.

The app creates both the new board and its incomer feeder. For multiple boards, use **Build hierarchy** to create and connect them in batches.

To move an existing downstream board to another supply, drag it onto the new parent in the panel tree. Confirm the move and then check the incomer cable length. A board cannot be moved beneath itself or one of its descendants.

### 3.4 Add an equipment feeder or load

1. Select the supplying board.
2. Select **Add load**. Use its menu for a motor, solar PV, EV charger, or general feeder cable.
3. On **General & load**, enter a unique circuit ID and name, load type, connected load, demand factor, and power factor. Equipment can also be selected from the load library.
4. Mark generation, existing equipment, essential load, or standby duty where applicable.
5. On **Cable**, enter the route length, cores, cable size, parallel runs, installation method, cable type, and protective conductor. **Suggest cable size** checks ampacity and the remaining voltage-drop budget.
6. On **Protection**, enter the breaker rating, Icu, type, settings, circuit purpose, RCD/ELCB, and local isolator as applicable.
7. On **Metering**, select the kWh meter type if required.
8. Save the feeder.

The summary at the top of the feeder dialog shows design current, cable, protection, and total voltage drop while editing.

### 3.5 Edit and arrange the SLD

- Drag equipment from the equipment library onto a valid busbar or feeder target.
- Drag an existing load, board, or incomer to another valid target to reconnect it.
- Use **Edit** or **F2** on the focused item to change it.
- Use **Delete** to remove the selected item. Deleting a board also removes the network below it, so review the confirmation carefully.
- Use **Command/Ctrl+C** and **Command/Ctrl+V** on the diagram to copy a selected board with everything below it and paste it under another board.
- Use the board properties tabs—**General**, **Supply**, **Electrical**, **Protection**, and **Location**—to check the board and its supply chain.

The diagram toolbar also controls the displayed symbol set, DEWA-style panel frames, cable reference numbers, grid, and text detail. These settings affect the drawing presentation; they do not replace the electrical checks.

### 3.6 Run and review calculations

1. Select **Run** or press **F5**.
2. Review the status shown on the SLD and in the results drawer.
3. Open **System summary**, **Bus voltages & loading**, or **Feeders on _board ID_**.
4. Use the fail and warning controls to move through affected circuits.
5. Correct the source data, then run the calculations again.

Typical checks include design current versus breaker and cable capacity, voltage drop, breaker Icu versus fault level, earth-fault performance, and board loading. A stale-results notice means the displayed study values predate the latest design edit.

## 4. Create SLD drawing sheets

The SLD is the editable full-network canvas. The publishable drawing sheets are in **Design CAD > Sheets**. They are made from the design, so a design change shows on them.

### 4.1 Add sheets

1. Select **Sheets** on the ribbon, or **Design CAD > Sheets**.
2. Select **+ New sheet** above the sheet list.
3. Choose one of the available options, such as:
   - **Panel and its branch** (pick the panel);
   - **Empty sheet (tick panels)**;
   - a riser or earthing sheet; or
   - **Split all panels into sheets**.
4. Open the new sheet and check its paper size, panels, title, cable labels, and printed result layers.

Select **Side by side** on a sheet to show the design with each system sheet's panel boundary. A panel can be dragged into another sheet outline, and clicking a panel there makes it the start of **Panel and its branch**.

Right-click a sheet in the list to rename it, set its drawing number, duplicate or reorder it, advance its revision, change its status, export it, or delete it. Use **[** and **]** to move between All sheets and the sheets. Add revision clouds, notes, and callouts with the **Markup** tools on the ribbon, earthing sheets included; new markups are black. **Style** sets the colour and text height, **View** has Fit, zoom, Legend and Side by side, and **Issue and export** publishes the sheet or exports it as PDF, DXF or DWG.

### 4.2 Manage and export the drawing set

Open **Design CAD > Sheets > All sheets** to manage the complete drawing set. **Documents > Drawings** opens the same place.

- Create sheets automatically by panel count, per MDB, or as an overview plus one sheet per SMDB.
- Optionally add a circuit diagram for every DB.
- Set paper size, title, panels, status, revision, date, title-block details, cable-label style, and printed result layers.
- Preview sheets before issue.
- Export one combined PDF, a PDF per sheet, DXF per sheet, a ZIP containing PDFs, DXFs, and the register, or the drawing register by itself.

For a quick export of the full system diagram as currently shown on screen, select **Export…** on the SLD. Complete the title-block fields and export SVG, DXF, or PDF. Run calculations first if result labels are visible and marked out of date.

## 5. Create and edit load schedules

### 5.1 Open the correct panel

Select a board, then select **Detailed design > Schedule** or **Reports > Load schedule**. You can also:

- right-click a board in the panel tree and select **Load schedule**; or
- double-click a DB's final-circuit summary on the SLD.

Use the panel selector or the panel chips to move between boards. An exclamation mark beside a panel means its schedule or outgoing-load form has not been filled yet.

The form tabs group panels by submission type and can include:

- **TCL summary** for transformer-level totals;
- MDB, SMDB, MCC, and DB groups;
- **Busbar riser** when a bus riser exists;
- **Load schedule** for DB final circuits; and
- **Connected load & MD** for the incomer and outgoing feeders of a panel.

### 5.2 Complete a DB load distribution schedule

1. Select the DB and open **Load schedule**.
2. Confirm the supply chain, DB number, source board, location, and incomer.
3. Choose the ELCB grouping: six circuits, three circuits, or no ELCB.
4. Choose automatic lighting/power sensitivity or one sensitivity for all circuits.
5. Enter **WATT / UNIT** for every point column used by the DB, or select a linked library item. Resolve any yellow missing-watts message before relying on totals.
6. Select **Add circuit** for a single-phase final circuit or **Add 3-phase circuit** for an RYB circuit.
7. Enter the room or area and the point quantities in the applicable load columns.
8. Enter the circuit length. Length is used for voltage-drop and earth-fault checks but is not printed on the DEWA form or its PDF.
9. Add remarks where required.
10. Review the calculated load per phase, row check, phase totals, and imbalance.

Circuit references are assigned as phase plus way, such as R1, Y1, B1, and RYB for a three-phase circuit.

### 5.3 Edit circuits efficiently

Values can be edited directly in the table. The grid also supports:

- arrow keys and **Enter** to move;
- Shift+arrow or dragging to select cells;
- **Command/Ctrl+C** to copy;
- **Command/Ctrl+V** to paste from Excel;
- **Command/Ctrl+D** to fill down; and
- **Delete** or **Backspace** to clear a multi-cell selection.

Rejected bulk edits are reported in the status message and are not applied.

Double-click a circuit row to open **Edit circuit**. Use this dialog to:

- edit the room, length, point quantities, and remarks;
- list different load items and wattages on the same circuit;
- choose items from the load library; and
- switch between automatic and hand-selected MCB, wire, and ECC sizes.

When **Sized by hand** is cleared, the app sizes the MCB, wire, and ECC from the load again. A manually selected size is retained until automatic sizing is restored.

### 5.4 Add spares and spaces

- Select **Spare** for a way with a breaker fitted but no connected load.
- Select **Space** for an empty way reserved for a future breaker.
- Enable **3-phase** before adding one that occupies a complete RYB way.
- Edit the spare breaker rating and remarks in its row.

Neither a spare nor a space carries load. Delete one with the delete control on its row.

### 5.5 Balance phases

Select **Balance phases** after entering at least two circuits. The app:

- orders lighting circuits before power circuits;
- starts each category on an ELCB section;
- distributes circuits across R, Y, and B; and
- renumbers the circuits and repositions spares and spaces into the remaining slots.

Review the result before continuing because circuit references can change. The phase summary shows R, Y, and B watts and the percentage imbalance; values above 20% are highlighted for checking.

### 5.6 Complete connected load and maximum demand

Open **Connected load & MD** for an MDB, SMDB, MCC, meter cabinet, or another panel with outgoing feeders.

1. Review the project and authority-form header information.
2. Select **Add feeder** for an equipment feeder that does not supply another panel.
3. Enter its load in the TCL column and complete the editable type rating, cable type, meter, and remarks cells.
4. Add spare or space ways as required. By default these are three-phase; select **1-phase (SP)** before adding a single-phase way.
5. Edit loads in downstream panels or DB schedules when a feeder supplies a panel. Their connected load and maximum demand roll up automatically and should not be typed over at the parent.
6. Review the demand factor, maximum demand, total connected load, and metering proposal.

A feeder that supplies another panel cannot be deleted from this form because that would leave the panel without a supply. Move or delete the supplied panel on the SLD instead.

### 5.7 Review transformer and riser summaries

- Open **TCL summary** to review each transformer's breaker, fault duty, phase loads, TCL, demand factor, MDL, and meters.
- Open **Busbar riser** to review each floor tap-off and its connected load, phase totals, demand, and metering.
- Correct source data in the relevant SLD feeder, panel form, or DB load schedule. Summary values are calculated from the network below them.

## 6. Export load schedules and submission forms

The available export controls depend on the open form.

- **Export Excel** exports the current form in the authority-style workbook layout.
- **Export PDF** exports the current form. A DB schedule has its own landscape PDF export.
- **Export CSV** exports the current DB load schedule as table data.
- **Submission pack (Excel)** exports all project forms in one workbook: transformer summary, connected-load and MD forms, risers where present, and DB load schedules.

Before exporting:

1. Clear missing **WATT / UNIT** warnings.
2. Review incomplete-panel exclamation marks.
3. Check R/Y/B balance and mixed ELCB warnings.
4. Resolve failed row checks or document accepted exceptions.
5. Confirm project, authority, consultant, location, plot, completion, and revision details.
6. Run calculations with **F5** and save the project.

## 7. Recommended end-to-end workflow

1. Complete project settings, parameters, title-block details, and load schedule defaults.
2. Create the main boards and downstream hierarchy.
3. Add incomers, major equipment feeders, essential loads, and generation on the SLD.
4. Complete every DB load schedule, including watts per point, circuit lengths, spares, and spaces.
5. Balance phases and review ELCB grouping.
6. Review each parent panel's **Connected load & MD** form.
7. Run calculations and correct failures and warnings.
8. Create and preview the SLD drawing sheets.
9. Export the SLD set and load-schedule submission pack.
10. Save the project and retain the issued outputs with the correct revision.

## 8. Troubleshooting

### A circuit shows 0 W

Check its point quantities and the DB's **WATT / UNIT** row. Any used column with no watts-per-unit value contributes 0 W.

### The SLD or a study shows old results

The design was edited after the last calculation run. Select **Run** or press **F5**.

### A DB has no load schedule rows

Open the DB and select **Add circuit** or **Add 3-phase circuit**. Confirm that the selected panel is the intended DB.

### A circuit cannot be resized automatically

Open **Edit circuit** and clear **Sized by hand**. Confirm that the load, length, project voltage, voltage-drop limit, and minimum wire settings are valid.

### Lighting and power are marked as mixed on an ELCB

Select **Balance phases** to regroup and renumber the circuits, then review the revised circuit references.

### A feeder cannot be deleted from Connected load & MD

It supplies another panel. Move that panel to a different source or delete it from the SLD.

### A drawing sheet is empty or missing panels

Open the sheet settings and select the required panels, or recreate the sheet from **Panel and its branch**. Use **Side by side** to verify sheet allocation.

### Exported calculation labels may be stale

Run calculations before export. The quick SLD export reproduces the diagram as shown on screen, including visible result labels and the selected operating view.
