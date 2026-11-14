# UI UX proposal – Load schedule formats by authority (2026-11-14)

Status: **proposal, partly answered on 2026-11-14** (see "Owner's answers" below). The app's tables stay as the general format; an office's own format is linked and scheduled in Sheets. Nothing here is built.

## Owner's answers — 2026-11-14

- **Order (decision 7):** fix the table format first, then think about the Sheets part. Decisions 1 and 5 belong to Sheets and wait with it.
- **Changing the authority (decision 2):** allowed. The owner asked whether the table then updates by itself.
  - Today it does for DB circuits: applying another set sizes every auto-sized circuit on every DB schedule again at once (`refreshBoard` after `applyReference`, `App.tsx`). Circuits marked Sized by hand keep their size. Limit remarks are rewritten by the sizing.
  - Feeders between panels are not sized again by that step. To build: Change authority sizes them again too and reports how many circuits and feeders changed.
- **Formats by authority (decision 3):** no authority-named formats. One **General** format set is built in and is the default for every authority, DEWA included. Read as: the two point-column sets stay, named without "DEWA", and the fixed word "DEWA" on the forms is replaced by the name of the project's authority.
- **One format set per project (decision 4), with one table per panel category:** DB, SMDB, MDB, MCC and the load summary (and the busbar riser).
  - Today: DB → load distribution schedule; MDB and the other main or metered boards → connected load, maximum demand and kWh metering; SMDB, MCC and the rest → connected load / maximum demand (one shared table); transformer level → TCL summary.
  - New: SMDB and MCC become separate entries in the set, so each can have its own columns.

### Second answer, same day — what Sheets is for

The owner explained the reason for bringing Sheets into this: the app cannot know which table format an office uses for which panel. So:

- **The app's Load schedule tables are the general format and stay as they are**, one table per panel category as today. Nobody has to customise them, and nobody has to use Sheets. (This replaces the "table follows the format" idea in section 3 below, and no Columns screen is needed.)
- **An office with its own format uses Sheets**: it opens its Excel layout, says which panel category the sheet is, and links its columns to project fields once.
- **Scheduling can be done directly in that sheet.** What is typed there reaches the project, and the SLD and every document are drawn from the project as always. A board scheduled in a sheet also appears in the app's table, and the other way round.

How it would work:

- **Format per panel category.** The project holds one line per category (DB, SMDB, MDB, MCC, load summary): General, or one of the office's sheet formats. General is the default for every authority.
- **What a sheet must have to build a board and the SLD:** a panel number cell, a Fed from cell, and one row per circuit with a description or a load. MCB and cable are optional: left blank, the sizing fills them by the authority's rules; typed, they are kept as sized by hand and checked against the limits.
- **A load typed in watts** is kept as a load item on the circuit (`Feeder.loadItems` exists). Point-count columns link to the point types.
- **Typed cells go through the same path as the app's table** (`applySheetEdits`, `src/docs/dbSheet.ts`), so a value that does not fit is refused with the same message and the same sizing runs.
- **Rules are applied once**, when a circuit reaches the project, whichever way it came in. A typed size over a limit is marked in the sheet before it is applied.
- **Own columns** (for example cable route) are kept with each circuit, so they follow it when rows move. This answers decision 6: it is needed for an office format.
- **Limits of the first version:** one row per circuit and one panel per sheet. Layouts with two circuits on one row, or several panels on one sheet, are a later step.

Revised steps (replace the list further down):

1. **General wording.** The fixed word "DEWA" on the app's forms comes from the project's authority; the two point-column sets lose "DEWA" in their names. No other change to the Load schedule tab.
2. **Sheets keeps merged cells and borders** of an opened file, so an office layout looks as it does in Excel.
3. **Link columns for a DB sheet**: the panel, the needed-fields check, Save as my format; the sheet is filled from the project and stays up to date.
4. **Schedule in a DB sheet**: typed rows and cells reach the project (Apply to project), new panels are added under their Fed from board, own columns are kept with each circuit, over-limit marks.
5. **SMDB, MDB and MCC sheets** the same way (outgoing ways and feeders).
6. **Format per panel category** in the project and at project start; Change authority re-sizes feeders and lists what changed.
7. **Later:** load summary formats, the read-only Rules page and the look-up functions, two circuits per row and several panels per sheet.

Still open: Apply to project as a button (as agreed for Sheets on 2026-11-13) or as you type; and two or three of the owner's office schedules to test the links with.

### Progress

The owner approved the revised steps on 2026-11-14 ("Okay, start do it"). Apply to project stays a button, as agreed on 2026-11-13.

- **Step 1, general wording:** PR 573 (v2.129). `supplyAuthorityOf(project)` gives the authority of the set the project applied (DEWA when none, AUTHORITY for a standard). A new main board takes it as its Fed from, and the Connected load & MD form, the TCL summary and the Excel DB form use it where a supply has no Fed from of its own. The point-column sets are named Villa and Standard. Found on the way: every new main board had "DEWA" written into it, so the forms' own fallback rarely ran. A board that already stores DEWA keeps it. The SLD's own fallback and the "DEWA submission" report type are not changed.
- **Step 2, merged cells and borders in Sheets:** PR 574 (v2.130), stacked on 573. Merged areas and thin or thick borders are read, shown and saved; empty bordered cells are kept; Merge cells and Borders on the Home tab work. Not seen on screen yet.
- **Step 3, link model (no screen):** PR 575, stacked on 574, no version bump. `Sheet.link` (cells, first row, column fields), the field list shared with the Excel template (`src/docs/scheduleFields.ts`, with the new `row.phase` and `row.length`), `linkNeeds`, `linkFromPlaceholders` (a file with the template's placeholders becomes a linked sheet) and `fillLinked`, which rebuilds the circuit rows from the project, keeps totals such as `=SUM(D6:D10)` over the block, and keeps a text typed in an own column with its circuit. Limits: one row per circuit, one panel per sheet, a range over part of the block is not stretched.
- **Steps 1 to 3 (PRs 573, 574, 575) merged and installed as v2.130 on 2026-11-14.**
- **Link columns panel:** v2.131. Electrical tab → Link columns opens a panel beside the grid: Suggest links from the headings, the board, the first circuit row, the linked cells and columns, the needed-fields check, Add a sheet for every other DB, Remove the link. The shown sheet is filled live from the project (`fillLinked` on the shown sheet; nothing is written by looking). Linked cells are read only until Apply to project; own columns can be typed in. Not built here: Save as my format (the library across projects comes with the format per panel category).
- **Link columns panel (PR 577) merged and installed as v2.131 on 2026-11-14.**
- **Apply to project:** v2.132. In a linked sheet the description, load, points, MCB, cable, earth, length and remarks can be typed; typed values are kept beside the link (`link.pending`, `link.added`), marked, and reach the project through `applyLinked` (`src/docs/sheetApply.ts`), which uses the Load schedule tab's own edits (`applySheetEdits`, `addCircuit`, `updateCircuit`). Add circuit adds a row; a blank MCB and cable are sized by the rules; a typed size is kept as sized by hand and marked when the circuit would fail its check. A load typed in watts becomes one load item (lighting when the description says lights, else other). Refresh from project drops what was not applied. Not built: a new panel from a sheet, deleting a circuit from a sheet, SMDB / MDB / MCC sheets, Save as my format.
- **Database tables:** the Database screen already edits every workbook in the app (Edit here, Save to Excel, backup); no second editor is planned in Sheets unless the owner asks for Excel-style editing there.
- **Apply to project (PR 578) merged on 2026-11-14 as v2.132.**
- **Save as my format:** v2.133. Link columns → Save as my format keeps the linked layout (`templateOf`: the block cut back to its pattern row, no board, no typed values) in the office library (`src/model/scheduleFormats.ts`, key `lvds.scheduleFormats`, synced through Library.json). Electrical tab → My formats adds a sheet in that layout for a chosen board or for every DB without one, and renames or deletes formats.
- **Next:** the format per panel category at project start; SMDB, MDB and MCC sheets; a new panel from a sheet; deleting a circuit from a sheet.

The mockup was redrawn as revision 2 after this answer. Sections 2 to 6 of "Proposed" below are the first version and are kept for the record; where they differ from this section, this section holds.

Mockup: `docs/mockups/load-schedule-authority-formats-mockup.html` (image: `load-schedule-authority-formats-mockup.png`). Figures in it are examples.

![Schedule format chosen at project start, followed by the Load schedule table and by Sheets](../../mockups/load-schedule-authority-formats-mockup.png)

Follows [UI UX proposals - 2026-11-13 - Sheets (built-in Excel editing)](UI%20UX%20proposals%20-%202026-11-13%20-%20Sheets%20(built-in%20Excel%20editing).md) (stages 4 and 5: link columns, Electrical tab) and the authority rule sets built in v1.83 and v2.097.

## The question

The owner asked on 2026-11-14: the app has the Load schedule tab and the built-in Sheets page. How can the load schedule format of each authority be mapped through both, where is it set up (the authority is chosen before the project starts and does not change at random), how do the authority's rules (the DEWA cable / breaker limits) come into the Excel tables, and how does a user customise it?

## Today

- **Project start** asks Country → Authority → Rule set (`AuthorityPicker`, `src/components/BriefEditor.tsx`). The chosen set is copied into the project with its version (`Project.designReference`).
- **An authority set** (`DesignReference`, Standards → Design references) holds 13 design values, rule rows and the cable / breaker limits (`CableLimitSet`: DEWA Tables 1–3, size up / warn / off). A user duplicates a built-in set and edits the copy.
- **Changing it later** is one button (Apply to this project…). Nothing asks twice and nothing lists what will change.
- **The schedule format is not part of the authority set.** All four forms of the Load schedule tab (DB schedule, Connected load & MD, TCL summary, Busbar riser) are drawn to the DEWA layout. The only choice is the point-column template (DEWA villa or DEWA standard) in Project settings. An ADDC or EtihadWE project gets the DEWA layout and the word "DEWA" on its forms (`mdSheet.ts`, `txSummary.ts`, `formWorkbook.ts`).
- **Your own Excel format** exists for export only: an .xlsx with `{{placeholders}}` (`src/docs/xlsxTemplate.ts`). It is kept per computer, one file, not with the authority or the project.
- **Sheets** has the grid, formulas, File and Home tabs, and opens and saves .xlsx. It has no link to the project yet; its Electrical tab is greyed. It does not keep merged cells, borders or colours of an opened file.

## Proposed

### 1. The schedule format becomes the fourth part of the authority set

An authority set holds: design values, rule rows, cable / breaker limits, and now **schedule formats**. A format is one form laid out as a sheet, with each column linked to a project field:

- the heading block (project, DB no., fed from, location) and the heading rows;
- the columns in order, each linked to a field (MCB rating, wire, room, points, load per phase, remarks…), or marked as *your own column*;
- which row repeats for every circuit and spare, and the total rows;
- the Excel file it came from, kept whole, so the Excel output keeps its merges, borders and logo (this is how the template export already works).

Built in: **DEWA villa form** and **DEWA standard form** (today's two point templates with today's columns), and a **General form** with no authority wording.

### 2. Chosen when the project starts, then fixed

- New project → Country → Authority → Rule set → **Schedule format**, with a preview of the column headings.
- The format is copied into the project with the rules and limits. Updating the library later does not change a running project.
- Project settings shows the authority, rule set, limits and format as read-only lines with one button, **Change authority…**. It lists what will change (values, rule rows, limits, format, circuits to be sized again, board sheets to be rebuilt), asks for a tick, and adds a revision note.

### 3. The Load schedule table follows the format

- Column order, headings and hidden columns come from the project's format. The table-only columns (Length, Check) stay at the end.
- Circuits, sizing, checks and remarks do not change. The limit remark ("DEWA Table 1: 10 mm² for 32 A (6 mm² max 30 A)") is written by the sizing, as today.
- A line above the grid names the format, the authority set and the limits, with **Open in Sheets**.
- Authority wording on the forms comes from the project's set, so an ADDC project no longer prints "DEWA".

### 4. Sheets shows the same board as the authority form

- Electrical → Sheets for a board → **Authority format** (or **My office format**) makes a sheet for the board from the project's format: the form as laid out, filled from the project.
- **Link columns** panel: "Your column → project field" with a pick list. No typed placeholders; a file that already has `{{placeholders}}` is read as links.
- A change in a linked cell is marked and reaches the project only through **Apply to project**. **Refresh from project** brings the sheet up to date.
- Columns can be moved, renamed or hidden, and the result saved with **Save as my format…**.

### 5. The authority's rules inside Sheets

The rules stay in one place: the copy in the project. Sheets shows them three ways.

1. **Rules sheet** (read only) in the board's workbook: the design values, the rule rows and the cable / breaker tables of the project's set. Values are changed in Standards → Design references, not here.
2. **Functions** for your own columns:
   - `MAXBREAKER(wire)` — largest breaker the table allows on that wire;
   - `MINWIRE(breaker)` — smallest wire the table allows for that breaker;
   - `RULE("VD limit")` — a design value.
   - A plain `VLOOKUP` into the Rules sheet also works.
3. **Marks**: a linked cell that breaks a limit is marked with the reason ("4 mm² carries at most 20 A — DEWA Table 1"). On Apply to project the sizing does what the set's mode says: size up and remark, warn, or nothing.

In a saved .xlsx the Rules sheet is plain values with the set's name, version and date; the three functions keep their last values.

### 6. Customising

Three levels, each a copy of the one above it (the same pattern as rule sets):

| Level | Where | Who changes it |
|---|---|---|
| Built-in authority form | In the app, read only | Updated with the app |
| Your office form | Your library, shared through `Library.json` | You: duplicate, edit in Sheets, or New from an Excel file… |
| This project | In the project file | You: a change for one project; Save to my formats to keep it |

Typical uses:

- **Villa and building forms** under one authority: pick the form at project start.
- **Office format**: own heading block, column order and headings; the authority's fields stay linked.
- **Own columns**: a formula column (total per circuit, max breaker from the table, a pass / fail) or a free column (cable route, contractor's note) kept with each circuit.
- **An authority the app does not have**: open its Excel form in Sheets, link the columns, save it as a format under your copy of the nearest rule set.

Standards → Design references gets a **Schedule formats** card under Cable / breaker limits: the list of formats per form, the default for new projects, Duplicate, Edit in Sheets, New from an Excel file…, Export format.

### 7. ADDC and EtihadWE

Their official forms are not in the app, and they are not invented here. Until they are added, these authorities start on the General form. The forms and the full regulations are still needed from the owner (open since 2026-10-27).

## What stays the same

- The Load schedule tab stays the working table. Sheets is the form view and the place to design a format.
- The calculation and the limits are applied by the engines only. No formula in a sheet changes a size.
- A DEWA project's table, Excel and PDF output stay as they are today (checked by the existing regression and PDF baselines).
- PDF output stays black-and-white.

## Steps (one PR each)

1. **Format model**: schedule formats on the authority set and on the project; DEWA villa, DEWA standard and General built in; point templates become formats; authority wording from the set. No screen change; DEWA output unchanged.
2. **Project start and Project settings**: the fourth choice with its preview; the read-only lines and Change authority… with its list.
3. **Load schedule table follows the format**: order, headings, hidden columns, the line above the grid.
4. **Sheets keeps merged cells and borders** (its Merge cells button is not connected today). Needed before a form looks right in Sheets.
5. **Sheets link**: Link columns panel, Authority format / My office format for a board, Apply to project, Refresh from project.
6. **Rules in Sheets**: Rules sheet, `MAXBREAKER` / `MINWIRE` / `RULE`, marks, Check sheet.
7. **Schedule formats card** in Design references; your own Excel template moves from the per-computer setting into the formats (old files keep working); `lvds schedule-xlsx --format`.
8. **Own free columns** kept with each circuit; formats for the Connected load & MD form, TCL summary and Busbar riser.
9. **ADDC and EtihadWE forms**, when the official forms arrive.

Steps 1–3 work without Sheets. Steps 4–6 are the Sheets stages 4 and 5 of the earlier proposal, in this order.

## Decisions needed

1. **One definition or two?** Suggested: one. The form sheet with its links is the format, and the table takes its column order, headings and hidden columns from it.
2. **Changing the authority after the project starts.** Suggested: allowed, but only through Change authority… with the list and the tick. Other choices: locked after the first issued revision; or as today (one button).
3. **ADDC and EtihadWE until their forms arrive.** Suggested: the General form. Other choice: keep the DEWA layout with the authority's name.
4. **One format per project, or per board too?** Suggested: per project now; a different form for one board (a plant-room panel in a villa project) later.
5. **Rules in Sheets.** Suggested: all three (Rules sheet, functions, marks). Other choice: marks only.
6. **Own free columns kept with each circuit.** It needs a small addition to the circuit data. Suggested: yes, in step 8.
7. **Order.** Suggested: steps 1–3 first (the table), then Sheets.

Also needed: the ADDC and EtihadWE load schedule forms, and two or three office Excel schedules to test the links with.

## Not in this proposal

- Submission sets (which documents each application stage needs).
- Rule sets for other countries.
- Charts, pivot tables, macros and conditional formatting in Sheets (left to Excel, as agreed on 2026-11-13).
