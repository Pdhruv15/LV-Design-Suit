# Phase 1 — PDF export inventory

**Repo state:** v1.38.0, commit `de73cf4` · 15 October 2026  
**Method:** every `savePdf(` / `renderPdf(` call in `src/` (32 call sites, excluding tests), traced to its HTML builder, page frame and stylesheet.

All PDFs go through one save path: `src/util/files.ts` `savePdf` → `renderPdf` → Electron `printToPDF` (`electron/main.cjs`) → `pdfTools.finishPdf`. The finishing pipeline is already shared, so Phase 1 only covers **frame and styles**.

## Frame / style families

| Family | Builder files | Look today |
|---|---|---|
| **A. `printDoc` (BOQ style)** | `report.ts` (+`PLAIN_CSS`), `voltageDropReport.ts` (+`PLAIN_CSS`), `boqWorkbook.ts`, `variationReport.ts`, `submissionReport.ts` | **Already black and white**: Arial, black rules, `#f2f2f2` header fill, running header/footer, Page n of N. Use as the base for the shared style. |
| **B. `REPORT_CSS` + `REPORT_DOC_CSS`** | `studyReport.ts` (cover, document control, contents), `reviewReport.ts` (`REPORT_CSS` only) | Colour: blue headings `#1d4f8f`, green/amber/red status, amber warning fill, Segoe UI |
| **C. Own inline `<style>`** | `dashboardPdf.ts`, `buildingSummary.ts`, `pfcReport.ts`, `upsSolarReport.ts`, `containmentReport.ts`, `trayReport.ts`, `issuePackage.ts`, `loadScheduleDoc.ts`, `EnclosureSizing.tsx` (inline in the component), `model/drawingSet.ts` | Mostly colour, with a different style per file |
| **D. Authority forms** | `dmForm.ts` (DM-D-013), `sheetPdf.ts` `FORM_CSS` (MD / TCL / riser workbooks, schedules) | Form layouts; `sheetPdf` uses a light-blue header fill `#e8edf5`, `dmForm` uses blue/red |
| **E. Drawings** | `sldSheet.ts`, `boardSheets.ts`, `sheet.ts`, `sheetRender.tsx` (A1–A4 sheets) | Title blocks + SVG; `sheet.ts` has status colours |

## Export inventory

| # | Deliverable | UI entry (file:line) | Builder | Family | Page | Colour today | Phase 1 action |
|---:|---|---|---|---|---|---|---|
| 1 | Calculation report | `docs/Documents.tsx:103` | `report.ts` `buildReportHtml` | A | A4 L | None | ✅ On tokens; FAIL boxed |
| 2 | Voltage drop report | `studies/VoltageDropStudy.tsx:98` | `voltageDropReport.ts` | A | A4 L | None | ✅ On tokens (`printDoc`) |
| 3 | BOQ / BOQ summary | `docs/BomView.tsx:112` | `boqWorkbook.ts` | A | A4 | None | ✅ On tokens (`printDoc`) |
| 4 | Variation register / VO | `docs/VariationsView.tsx:35` | `variationReport.ts` | A | A4 | None | ✅ On tokens (`printDoc`) |
| 5 | Submission register | `docs/SubmissionsView.tsx:28` | `submissionReport.ts` | A | A4 | None | ✅ On tokens (`printDoc`) |
| 6 | Document transmittal | `docs/SubmissionsView.tsx:32` | `submissionReport.ts` | A | A4 | None | ✅ On tokens (`printDoc`) |
| 7 | Study report (single / combined) | `docs/StudyReportsView.tsx:140,146` | `studyReport.ts` | B | A4 L | Yes | ✅ Done (incl. charts in `compliance.ts`) |
| 8 | Issue package (merged) | `docs/StudyReportsView.tsx:210` | `studyReport.ts` + `issuePackage.ts` | B/C | A4 L | Yes | Report part ✅; package cover (`issuePackage.ts`) still to do |
| 9 | Cable sizing study | `studies/SizingStudy.tsx:64` | `studyReport.ts` | B | A4 L | Yes | ✅ Done (via #7) |
| 10 | PFC study | `studies/PfcStudy.tsx:62` | `studyReport.ts` | B | A4 L | Yes | ✅ Done (via #7) |
| 11 | Busbar study | `studies/BusbarStudy.tsx:69` | `studyReport.ts` | B | A4 L | Yes | ✅ Done (via #7) |
| 12 | Technical review / clarification | `docs/ReviewView.tsx:54` | `reviewReport.ts` | B | A4 L | Yes | ✅ Done |
| 13 | Project summary (dashboard) | `docs/ProjectDashboard.tsx:79` | `dashboardPdf.ts` | C | A4 L | Yes (13 colours) | **Remove colour** |
| 14 | Building summary | `docs/BuildingView.tsx:45` | `buildingSummary.ts` | C | A4 | Yes | **Remove colour** |
| 15 | PFC calculation | `studies/PfcCalculator.tsx:30` | `pfcReport.ts` | C | A4 | Yes | **Remove colour** |
| 16 | Solar PV sizing | `studies/SolarStudy.tsx:50` | `upsSolarReport.ts` | C | A4 | Yes | **Remove colour** |
| 17 | UPS / battery sizing | `studies/UpsStudy.tsx:42` | `upsSolarReport.ts` | C | A4 | Yes | **Remove colour** |
| 18 | Containment calculation | `docs/ContainmentCalculator.tsx:32` | `containmentReport.ts` | C | A4 | Yes | **Remove colour** |
| 19 | Cable tray schedule | `docs/TrayScheduleView.tsx:120` | `trayReport.ts` | C | A4 | Yes | **Remove colour** |
| 20 | Enclosure sizing | `EnclosureSizing.tsx:146` | inline in component | C | A4 | Yes | **Remove colour; move builder to `src/docs/`** |
| 21 | DB load schedule | `docs/LoadScheduleView.tsx:150` | `loadScheduleDoc.ts` | C | A4 L | Yes (amber/red) | **Remove colour** |
| 22 | Drawing register | `docs/DrawingsView.tsx:110` | `model/drawingSet.ts` `registerHtml` | C | A4 | Yes | **Remove colour** |
| 23 | Drawing issue transmittal | `docs/DrawingsView.tsx:112` | `model/drawingSet.ts` `transmittalHtml` | C | A4 | Yes | **Remove colour** |
| 24 | Authority workbook (MD / TCL / riser) | `docs/LoadScheduleView.tsx:103` | `sheetPdf.ts` `workbookHtml` | D | A4 L | Light-blue header | Grey header only; **keep form layout** |
| 25 | DB / cable / equipment schedules | `docs/Documents.tsx:37` | `sheetPdf.ts` `scheduleHtml` | D | A4 L | Light-blue header | Grey header only |
| 26 | DM-D-013 substation areas | `docs/SubstationAreaView.tsx:43` | `dmForm.ts` | D | A4 | Yes | Remove colour; **keep prescribed layout** |
| 27 | SLD | `SldExportDialog.tsx:46` | `sldSheet.ts` | E | A1–A3 | Red mark | Out of Phase 1 (drawings) |
| 28 | Earthing schematic | `EarthingView.tsx:107` | `sldSheet.ts` | E | A3 | — | Out of Phase 1 |
| 29 | DB circuit diagram (single / batch) | `BoardSheetView.tsx:89,102` | `boardSheets.ts` | E | A3 | — | Out of Phase 1 |
| 30 | Drawing sheets / set / SLD set (merged) | `docs/sheetRender.tsx:208,242,255` | `sheet.ts` + `mergePdf.ts` | E | A1–A4 | Status colours | Out of Phase 1; review status colours in Phase 3 |

Not PDF (out of scope): Word exports (`studyWord.ts`, `reviewWord.ts`), DXF (`dxf*.ts`, `sheetDxf.ts`), Excel/CSV workbooks.

## What this changes in the plan

- **The main calculation report is already black and white** (`printDoc` + `PLAIN_CSS`). The colour is in the **study reports** (`REPORT_CSS` + `REPORT_DOC_CSS`), the review report, and the family C/D one-off builders.
- Phase 1 scope: **20 exports** (#7–#26) need colour removed. **6 exports** (#1–#6) only adopt the shared tokens. **Drawings (#27–#30) stay as they are** until Phase 3.
- The `printDoc` BOQ style is the reference look; `mockup.html` / `mockup.pdf` extend it with the `reportFrame` cover, document control, check summary and status styling.

## Proposed status styling (no colour)

| Status | Print style |
|---|---|
| PASS | Plain |
| WARNING | **Bold** |
| FAIL | **Bold, boxed** |
| NOT CHECKED | *Italic, grey* |
| DATA REQUIRED | *Italic, grey* |

## Progress — step 1 (shared stylesheet), 15 Oct 2026

- New `src/docs/printStyles.ts`: `PRINT` tokens, `PRINT_BASE_CSS`, `STATUS_CSS`, `NOTE_CSS`, `statusSpan()`.
- On the tokens: `printDoc.ts` (family A), `REPORT_CSS` / `PLAIN_CSS` (`report.ts`), `REPORT_DOC_CSS` (`reportFrame.ts`), `studyReport.ts` inline styles and status cells, `compliance.ts` charts (greyscale) and status cells.
- Guard test: `src/docs/printStyles.test.ts`, which checks for no colour and no unfilled `${…}` in the shared CSS, calculation report, study report, review, clarification and `printDoc`.
- Samples: `samples/before-*.pdf`, `samples/after-*.pdf`, and `samples/after-study-report-with-fails.pdf` (VD limit 0.5 % to show boxed FAIL).
- Page counts (body 9 pt, tables 8 pt, was ~7.5 pt): study report 45 → 51, calculation report 14 → 15, technical review 2 → 3, clarification 1 → 2. No table overflow in any of them.

**Remaining for Phase 1:** family C (#13–#23 and the issue-package cover) and family D (#24–#26).
