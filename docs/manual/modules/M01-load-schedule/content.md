# M01 - Load Schedule

<a id="LS-010"></a>
## Purpose and data flow

Use the Load Schedule workspace to enter DB final circuits and to review how
connected load and maximum demand roll up through SMDBs, MDBs, busbar risers,
and transformers.

The load schedule and SLD use the same project data. Editing a circuit, breaker,
cable, load, or panel in one place updates the other views and documents that use
that item. Network study results can become stale after an edit; run calculations
with **F5** before reviewing calculated results or issuing documents.

<a id="LS-020"></a>
## Before starting

Confirm the following:

1. The project voltage, frequency, ambient conditions, and voltage-drop limit.
2. Minimum lighting and power circuit wire sizes.
3. Default lighting and power ELCB sensitivities.
4. The required load-schedule point columns.
5. Default watts per point or the applicable load-library items.
6. Panel IDs, types, locations, and supply relationships.
7. Project and submission-form information.

A point type with no **WATT / UNIT** value contributes 0 W until a value is entered.

<a id="LS-030"></a>
## Open the correct panel and form

Open the workspace from **Detailed design > Schedule** or **Reports > Load schedule**.
You can also right-click a board in the panel tree and select **Load schedule**.

Choose the form according to the task:

- DB lighting, socket, HVAC, and equipment final circuits: **Load schedule**.
- Panel incomer and outgoing feeders: **Connected load & MD**.
- Transformer totals: **TCL summary**.
- High-rise busbar tap-offs: **Busbar riser**.

An exclamation mark beside a panel means its schedule or outgoing-load form is incomplete.

<a id="LS-040"></a>
## Interface overview

The workspace contains:

1. A panel selector and the panel tree.
2. Form-group tabs for TCL, MDB, SMDB, DB, MCC, and riser forms.
3. Panel chips within the selected group.
4. The editable schedule or maximum-demand grid.
5. Excel, PDF, CSV, and submission-pack controls where applicable.
6. A status area for rejected edits and export results.

<a id="LS-050"></a>
## Watts per unit

Enter **WATT / UNIT** for each point column used on the selected DB. When the
database contains a suitable standard item, select it from the library. Typing a
value directly unlinks that column from the library.

Resolve every missing-watts warning before relying on connected-load totals.

<a id="LS-060"></a>
## Add final circuits

1. Select **Add circuit** for a single-phase final circuit.
2. Select **Add 3-phase circuit** for an RYB circuit.
3. Enter the room or served area.
4. Enter point quantities in the relevant load columns.
5. Enter the circuit length.
6. Review the calculated phase load and row check.

Circuit references use phase plus way, such as R1, Y1, B1, and RYB for a
three-phase circuit.

The grid supports arrow and Enter navigation, multi-cell selection, copy, paste
from Excel, fill down, and clearing a selected range. Rejected bulk edits are not
applied and are explained in the status message.

<a id="LS-070"></a>
## Edit circuits and mixed load items

Double-click a circuit row to open the detailed circuit editor. Use it to change:

- room or area;
- circuit length;
- point quantities;
- load items with different wattages on the same circuit;
- remarks; and
- automatic or manual protection and wiring sizes.

Use load items when one point column contains different fittings, such as two
lighting types with different watts per fitting. The grid displays the total item
count while the circuit calculation uses each item's own wattage.

<a id="LS-080"></a>
## Protection, wiring, and length

The app sizes the MCB, circuit wire, and ECC from the circuit load and project
rules. Enable **Sized by hand** only when a documented design decision requires a
manual value. Clear it to return the circuit to automatic sizing.

Length is used for voltage-drop and earth-fault checks. It is not printed on the
authority load-distribution form.

Review any indication that the selected wire is below the project's minimum for
the circuit category.

<a id="LS-090"></a>
## Spares and spaces

- **Spare** adds a fitted breaker with no connected load.
- **Space** reserves an empty position for a future breaker.
- Select **3-phase** before adding a complete RYB spare or space on a DB.
- On an MD form, spares and spaces are three-phase unless **1-phase (SP)** is selected.

Neither a spare nor a space carries load.

<a id="LS-100"></a>
## Balance phases

Use **Balance phases** after the circuit list is substantially complete. The operation:

- places lighting circuits before power circuits;
- starts each category on an ELCB section;
- distributes circuits across R, Y, and B;
- renumbers circuit references; and
- moves spares and spaces into the remaining positions.

Review changed circuit references before continuing. The phase summary highlights
an imbalance above 20 percent for checking.

<a id="LS-110"></a>
## Connected load and maximum demand

Use **Connected load & MD** for an MDB, SMDB, MCC, meter cabinet, or other panel
with outgoing feeders.

An equipment feeder's TCL value can be edited on this form. A feeder supplying
another panel receives its load from the panels and DB schedules below it; edit
the source data rather than typing over the rolled-up value.

Complete editable type rating, cable type, meter, and remarks fields, then review
demand factor, maximum demand, total connected load, and the metering proposal.

A feeder supplying a panel cannot be deleted from this form. Move or delete the
supplied panel from the SLD instead.

<a id="LS-120"></a>
## TCL and riser summaries

Use **TCL summary** to review each transformer's breaker, fault duty, phase loads,
connected load, demand factor, maximum demand, and meters.

When the project contains a busbar riser, use **Busbar riser** to review each
tap-off, connected load per phase, demand, and metering. Correct summary values at
their source panel, feeder, or DB schedule.

<a id="LS-130"></a>
## Validation and review

Before export, confirm:

- no missing **WATT / UNIT** warnings;
- no unexplained incomplete-panel markers;
- R/Y/B totals and imbalance have been reviewed;
- lighting and power circuits are not unintentionally mixed on an ELCB;
- row checks and minimum wire sizes are acceptable;
- circuit lengths are credible;
- rolled-up maximum demand matches the panel hierarchy; and
- calculations have been run after the last electrical edit.

<a id="LS-140"></a>
## Exports

- **Export Excel**: the current authority-style form.
- **Export PDF**: the current form as a PDF.
- **Export CSV**: the current DB load-schedule grid.
- **Submission pack (Excel)**: all applicable transformer, MD, riser, and DB forms.

Save the project before issuing exported files.

<a id="LS-150"></a>
## Troubleshooting

### A circuit shows 0 W

Check its point quantity and the DB's **WATT / UNIT** value for that point type.

### Lighting and power are marked as mixed

Use **Balance phases**, then review the changed circuit references.

### Automatic sizing is not changing a circuit

Open the circuit editor and clear **Sized by hand**. Check the load, length, and
project settings.

### A feeder cannot be deleted from the MD form

It supplies another panel. Move or delete that panel on the SLD.

### Totals look old

Run calculations with **F5** if calculated results are marked out of date.

<a id="LS-160"></a>
## Completion checklist

- [ ] Correct panel and form selected
- [ ] Watts per unit complete
- [ ] Final circuits and lengths complete
- [ ] Protection and wiring reviewed
- [ ] Spares and spaces recorded
- [ ] Phases balanced and references checked
- [ ] Connected load and MD reviewed upstream
- [ ] Validation warnings resolved or documented
- [ ] Calculations run
- [ ] Project saved
- [ ] Required exports generated

