# LV Design Studio — PDF Report Optimization Plan

**Repository:** [Pdhruv15/LV-Design-Suit](https://github.com/Pdhruv15/LV-Design-Suit)  
**Baseline:** v1.38.0, commit `de73cf4` (originally drafted against v1.37, 14 October 2026; checked against the repo 15 October 2026)  
**Audience:** Project owner, Claude Code, engineering QA  
**Objective:** Simplify report generation, eliminate redundant implementations, retain essential standalone deliverables, and establish a consistent, black-and-white engineering-document format.

> **Scope note:** The v1.37 review identified **34 distinct PDF output/document types**, **6 predefined study-report presets**, and **12 selectable engineering study sections**. These are different counting categories, not 52 independent PDF engines. v1.38 (IEC 60364-5-52 installation-method ratings) has landed since, so re-count the export entry points before any deletion or refactor.
>
> **Critical rule:** **Remove duplicate *code*, not required engineering documents.** Preserve the ability to export standalone reports, authority forms, and drawings even when their content is available in a combined report.

## 0. Current state (verified against v1.38.0)

The repo already has a good part of the shared infrastructure this plan calls for. The work is mainly to **bring the remaining exporters onto it**, not to build it from scratch.

| Area | Already in place | Gap |
|---|---|---|
| PDF finishing | `src/docs/pdfTools.ts`: `finishPdf`, `stampPages`, `stampFrame`, `addBookmarks`, `paginatePdf`, `destinationPages`; one `printToPDF` path in `electron/main.cjs` | Confirm every export goes through `finishPdf` (callers today: `src/util/files.ts`, `src/docs/mergePdf.ts`) |
| Document frame | `src/docs/reportFrame.ts`: `ReportDoc` model, cover page, document control, contents, running header/footer, `NOT_DEFINED` highlighting | Used by the study reports only; the main calculation report and the other exporters use their own frame |
| Validation | `src/docs/reportValidation.ts` (`validateReport`, `issueCounts`); `reportIntegrity` / `reportStatus` tests | Not applied to every export |
| Issue package / merge | `src/docs/issuePackage.ts`, `src/docs/mergePdf.ts` | — |
| Status labels | `src/calc/statusText.ts`: **PASS / WARNING / FAIL** + **NOT CHECKED / DATA REQUIRED** (`REPORT_STATUS_TEXT`), shared by screens and reports | Labels are shown in colour (green/amber/red) |
| PDF tests | `npm run test:pdf` → `tests/pdf/report.pdf.ts` (6 tests) | No image-level / visual regression coverage yet |

**Real gaps:**

1. **Colour.** The reports are not black-and-white yet. Blue headings (`#1d4f8f`), slate text and green/amber/red status colours are used in 15 files under `src/docs/` and `src/styles.css`, e.g. `report.ts:83-88`, `reportFrame.ts:201`, `studyReport.ts`, `dashboardPdf.ts`, `dmForm.ts`, `pfcReport.ts`, `upsSolarReport.ts`, `trayReport.ts`, `containmentReport.ts`, `buildingSummary.ts`, `issuePackage.ts`, `compliance.ts`, `sheet.ts`, `traySection.ts`.
2. **Two calculation-report paths.** `src/docs/report.ts` (`buildReportHtml`, `reportHead`, own CSS, `printDoc` frame) runs alongside `src/docs/studyReport.ts` + `reportFrame.ts`.
3. **Three style sets.** `PLAIN_CSS` and `REPORT_CSS` (`report.ts`) and `REPORT_DOC_CSS` (`reportFrame.ts`), used across `report.ts`, `reportFrame.ts`, `reviewReport.ts`, `studyReport.ts` and `voltageDropReport.ts`.
4. **Two page frames.** `printDoc.ts` (used by `report.ts`, `boqWorkbook.ts`, `variationReport.ts`, `submissionReport.ts`, `voltageDropReport.ts`) versus the `reportFrame.ts` cover / document-control frame.

## Impact and priority legend

| Label | Meaning |
|---|---|
| **Critical** | Directly affects calculation correctness, misleading output, or ability to issue reliable engineering documents |
| **High** | Substantial improvement in consistency, maintainability, or engineering workflow |
| **Medium** | Reduces friction and recurring effort; useful but not blocking |
| **Low** | Primarily polish or convenience |
| **P1** | Prioritize first |
| **P2** | Deliver after foundational fixes |
| **P3** | Optional refinement |

---

## 1. REMOVE — redundant implementations and unnecessary complexity

| # | Existing feature / implementation | Action | Impact | Priority | Guardrail |
|---:|---|---|---|---|---|
| 1 | Separate main calculation report implementation alongside the Study Reports calculation preset | Consolidate behind one report model/renderer | **High** | P1 | Preserve standalone Calculation Report export and all current calculations |
| 2 | Remaining PDF finishing outside `pdfTools.ts` | `finishPdf` already centralizes metadata, stamps, bookmarks and pagination. Audit the export routes and move any that bypass it | **Medium** | P2 | Protect drawing sheet sizes (`SHEETS` / `preferCSSPageSize` in `electron/main.cjs`) |
| 3 | `PLAIN_CSS`, `REPORT_CSS`, `REPORT_DOC_CSS` and per-exporter inline styles | Replace with one shared print-token stylesheet | **High** | P1 | Authority-prescribed and drawing layouts may need exceptions |
| 3a | `printDoc.ts` page frame alongside the `reportFrame.ts` frame | Move `printDoc` users onto the `reportFrame` header/footer/document-control | **High** | P1 | Keep the landscape option and each report's own content |
| 4 | Repeated export-button patterns | Use a shared export component and action handler | **Medium** | P2 | Retain convenient exports inside each module |
| 5 | Separate document and drawing transmittal templates with overlapping fields | Reuse one transmittal core with type-specific sections | **Medium** | P2 | Do not lose drawing revision/issue details |
| 6 | Re-entering project/client/consultant/report signatories | Resolve fields from a common project document-control model | **Medium** | P2 | Allow intentional report-specific overrides |
| 7 | Repeated HTML preview implementations | Use one print-preview container with page-size awareness | **Medium** | P2 | Preview must match saved PDF as closely as possible |
| 8 | Mandatory cover pages for small calculator reports | Make the cover optional for short reports | **Low** | P3 | Keep document number, revision, author, assumptions and disclaimer |

**Do not delete an export option until equivalent output is tested and the replacement is available.**

---

## 2. COMBINE — overlapping PDF outputs, without losing standalone export

| # | Existing outputs | Proposed combined group / feature | Impact | Priority |
|---:|---|---|---|---|
| 1 | Main Calculation Report + Study Reports “Calculation report” preset | **Engineering Calculation Report** — shared engine, standalone or comprehensive modes | **Critical** | P1 |
| 2 | Standalone Voltage Drop Calculation + Load Flow/Voltage Drop Study | **Voltage Drop Report** — quick, detailed and combined-study modes | **High** | P1 |
| 3 | DB Schedule + Cable Schedule + Equipment Schedule | **Electrical Schedules** — selectable schedule types in one batch export | **High** | P1 |
| 4 | Connected Load/Maximum Demand + Transformer TCL Summary + Riser Demand | **Load Assessment & Demand** — related authority schedules in one package | **High** | P1 |
| 5 | BOQ Summary + Detailed BOQ | **BOQ Report** — summary/full options from the same source model | **Medium** | P2 |
| 6 | Technical Review + Technical Clarification | **Technical Review & Clarification** — shared metadata/layout with distinct deliverable modes | **Medium** | P2 |
| 7 | Submission Register + Drawing Register | **Document Registers** — shared export design; preserve separate registers | **Medium** | P2 |
| 8 | Document Transmittal + Drawing Issue Transmittal | **Unified Transmittal System** — common header and tracked items | **High** | P1 |
| 9 | Solar PV + UPS/Battery + standalone PFC calculation | **Specialized Electrical Calculations** — shared format and optional combined PDF | **Medium** | P2 |
| 10 | SLD + DB Circuit Diagram + Earthing Schematic + Riser Diagram | **Electrical Drawing Package** — multi-sheet PDF with index | **High** | P1 |
| 11 | Project Dashboard + Building Summary | **Project Summary** — optional project/building sections | **Medium** | P2 |
| 12 | Cable Tray Schedule + Containment Calculator | **Cable Containment Reports** — data-linked sections in a combined export | **Medium** | P2 |

**Important distinction:** “Combine” means shared data and rendering infrastructure and/or a combined export option. It does **not** require combining separate engineering subjects into one inseparable PDF.

---

## 3. ENHANCE — quality, traceability, readability and output integrity

| # | Enhancement | Expected outcome | Impact | Priority |
|---:|---|---|---|---|
| 1 | Unified PDF template and print design tokens | Consistent typography, margins, tables and document identity | **Critical** | P1 |
| 2 | Consistent document numbering and revisions | Reliable document control across exports | **High** | P1 |
| 3 | Black-and-white styling | Clean prints in black/white, suitable for formal engineering review; remove the blue/green/amber/red colours in the 15 files listed in §0 | **High** | P1 |
| 4 | Calculation traceability | Inputs, methods, assumptions, standards/reference edition and outputs visible (build on `calcRecord.ts`) | **Critical** | P1 |
| 5 | Standard engineering result labels | Keep the existing labels from `src/calc/statusText.ts`: **PASS / WARNING / FAIL / NOT CHECKED / DATA REQUIRED**. Use them on every export and show them as text and weight, not colour. Renaming is out of scope because it also changes the screens | **Critical** | P1 |
| 6 | Width-aware table layout | No clipped columns or unreadably compressed schedules | **Critical** | P1 |
| 7 | Smart pagination | Avoid orphaned headings, broken rows and missing repeat headers | **High** | P1 |
| 8 | Table of contents and bookmarks | Exist for study reports (`tocHtml`, `addBookmarks`); extend to other long reports and packages | **Medium** | P2 |
| 9 | Standard units and rounding | Consistent kW, kVA, A, kA, mm², Ω, %, and significant digits | **High** | P1 |
| 10 | Common document-control block | `documentControlHtml` / `ReportDoc` exist; apply them to every export (project, client, consultant, doc no., rev., status, prepared/checked/approved) | **High** | P1 |
| 11 | First-page validation summary | All failed/unverified checks remain visible, never truncated silently (note `ATTENTION_MAX = 10` in `report.ts`; anything above the cap must be stated, not dropped) | **Critical** | P1 |
| 12 | Manufacturer/reference data provenance | Clear distinction between manufacturer-verified and approximate reference data | **Critical** | P1 |
| 13 | Vector-quality diagrams | Crisp electrical symbols and readable annotations at native sheet size | **High** | P1 |
| 14 | Central PDF export catalogue | Users can find every document type within logical categories | **Medium** | P2 |
| 15 | Batch export and selection | Export only chosen reports or a complete package | **Medium** | P2 |
| 16 | Issue package integrity | `issuePackage.ts` exists; review it against snapshot ID, contents, issue status, warnings, merged sections and bookmarks | **Medium** | P2 |
| 17 | Revision comparison | Clearly identified changed/added/removed design items between issues | **Medium** | P2 |
| 18 | Pre-export verification | `validateReport` exists for study reports; extend it to every export to block or prominently mark invalid/stale/unverified results | **Critical** | P1 |
| 19 | Visual regression testing | **New work:** `test:pdf` has 6 content tests only. Add image-level checks for wrapping, clipping, overlap, missing pages and shifted title blocks | **High** | P1 |
| 20 | PDF metadata | Meaningful title, subject, application version and document identifiers | **Low** | P3 |

---

## 4. Proposed report navigation — 7 categories

| Category | Deliverables |
|---|---|
| **1. Engineering Design Reports** | Full Design, Calculation, Load Assessment, Cable Sizing, Short Circuit, combined study report |
| **2. Electrical Calculations** | Voltage Drop, Transformer/Generator, PFC, Earthing, UPS/Battery, Solar PV, Enclosure, Containment |
| **3. Electrical Schedules** | DB Load Distribution, DB Schedule, Cable, Equipment, Cable Tray |
| **4. Authority Submission Forms** | Connected Load/MD, TCL Summary, Riser Demand, DM-D-013, DEWA submission package |
| **5. Electrical Drawings** | SLD, DB Circuit Diagram, Earthing Schematic, Building Riser |
| **6. Commercial Reports** | BOQ, BOQ Summary, Variation Register, Variation Order |
| **7. Project & Document Management** | Dashboard, Building Summary, Technical Review, Clarification, Registers, Transmittals, Issue Package |

Navigation categories are **not** a new count of PDF types. They group existing export options without removing necessary individual deliverables.

---

## 5. Unified PDF appearance — black-and-white specification

**Owner rule:** PDFs are black and white with no colour. Show a mockup and get the owner's sign-off before rolling a new format out across the exports.

| Element | Standard |
|---|---|
| Background | White (`#FFFFFF`) |
| Text | Black (`#111111`) |
| Secondary text | Dark grey (`#444444`) |
| Table header fill | Very light grey (`#F2F2F2`) |
| Rules and grid | Thin dark-grey or black lines |
| Main headings | Bold black; no decorative color bars |
| Status display | **PASS**, **WARNING**, **FAIL**, **NOT CHECKED**, **DATA REQUIRED** (from `statusText.ts`): written labels with bold for FAIL/WARNING, no colour |
| Font | Arial/Helvetica or another reliable embedded-safe sans-serif |
| Body text | Approximately 9–10 pt |
| Tabular text | Prefer 8–9 pt; never silently shrink until unreadable |
| A4 landscape | Wide calculations and schedules |
| A4 portrait | Narrative documents, forms and BOQ when suitable |
| A3/A2/A1 | Electrical drawings sized to actual technical content |
| Header/footer | Common project/title/doc no./revision/page fields |
| Warnings | Outlined callout with explicit written explanation; no colored fill needed |
| Engineering diagrams | Print-safe symbols and line weights; preserve semantics when printed in grayscale |

**Exceptions:** Keep legally or authority-prescribed forms in the required layout. Drawings may need limited functional color, but must remain understandable in grayscale.

### Example: consistent calculation result block

```text
LV DESIGN STUDIO                         CALCULATION REPORT
Project: Sample Commercial Building     Doc: ELEC-CAL-001 | Rev: P01
-------------------------------------------------------------
3.2  FEEDER VOLTAGE DROP

Circuit   Cable             Ib (A)  Length (m)  Total VD   Limit  Status
F-01      4C x 35 mm²       72.0       45       2.10%    4.0%   PASS
F-02      4C x 16 mm²       63.0       80       5.20%    4.0%   FAIL

Check F-02: Total voltage drop exceeds the project limit.
Calculation basis: [display actual method and data source].
-------------------------------------------------------------
NOT FOR CONSTRUCTION — illustrative values; independent check required.
```

The values in this block are **illustrative**, not validated engineering outputs.

---

## 6. Delivery roadmap

| Phase | Scope | Impact | Estimated relative effort | Exit criterion |
|---|---|---|---|---|
| **1** | (a) Mockup of the black-and-white format for owner sign-off; (b) one shared print-token stylesheet replacing `PLAIN_CSS` / `REPORT_CSS` / `REPORT_DOC_CSS`; (c) remove colour from the 15 files in §0; (d) move `printDoc.ts` users onto the `reportFrame.ts` header/footer/document control | **Critical** | Medium–High | Mockup approved; representative exports consistent and colour-free without breaking authority forms or drawing sheets |
| **2** | Merge `report.ts` `buildReportHtml` into the `studyReport.ts` section model (keep the standalone Calculation Report export) | **Critical** | High | Same inputs produce matching engineering results in every report route |
| **3** | Consolidate schedules, demand reports, drawing packages and transmittals | **High** | Medium–High | Individual and combined exports both work; no duplicate data logic |
| **4** | Pre-export validation, stale-study warnings, data provenance, traceability | **Critical** | High | No failed/unverified result is silently shown as PASS or omitted |
| **5** | Preview, bookmarks, batch export and automated render comparison (image-level testing is new work) | **High** | Medium | Regression suite checks content and image-level PDF layout |

**Versioning:** each phase that ships raises the minor version (Phase 1 → v1.39, Phase 2 → v1.40, …).

### Start with these three workstreams

1. **One print system:** Make `reportFrame.ts` the single frame and one shared print-token stylesheet the single style source. Bring `report.ts`, `printDoc.ts` users, `loadScheduleDoc.ts`, `dashboardPdf.ts` and the other exporters onto them. Allow intentional page-specific layouts.
2. **One calculation-report data source:** Reconcile the standalone `report.ts` calculation report with `src/docs/studyReport.ts` presets and its study sections. Keep both user-facing export choices if useful, but remove duplicated business logic.
3. **One validation policy:** Extend `reportValidation.ts` so all reports carry current/stale study state, warning/error counts, assumptions, source data, and clear invalid/unverified results.

---

## 7. Claude Code implementation and verification instructions

**Goal:** Execute this plan in a sequence of small, reviewable changes without altering engineering formulas merely for formatting.

### Before changing code

1. Checkout the latest intended branch; record commit SHA and app version.
2. Enumerate the current PDF export buttons and generators (do not assume the baseline count is unchanged).
3. Map each export to its source model, HTML renderer, PDF finishing path, and saved filename.
4. Produce baseline PDFs from the repository's sample project for every available export route.
5. Record page sizes, fonts, margin rules, footers, layout defects, and existing regression tests.

### Safeguards

- **Never** drop fields, warnings, calculations, schedules, or report sections merely to simplify presentation.
- Preserve drawings' native scale and page-size controls.
- Preserve standalone PDFs required for consultant review or authority submission.
- Do not merge data from different calculation runs into one apparently current PDF.
- Use an explicit fallback/exception for prescribed authority templates.
- Do not modify engineering calculation formulas without separate technical approval and independently verified tests.
- Do not push, merge, or release without owner approval.

### Run checks

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:pdf
```

All six scripts exist in `package.json` (v1.38.0). `test:pdf` currently runs only `tests/pdf/report.pdf.ts` (6 tests), so it does not cover printed layout.

Also generate and visually inspect representative PDFs in **portrait, landscape, multi-page, and drawing-sheet** formats. Report any tests that were not executed; never treat passing unit tests as proof of correct printed layout.

### Acceptance checklist

- [ ] Export inventory verified against the current branch.
- [ ] Every original deliverable has a maintained equivalent.
- [ ] Common document identity and black-and-white appearance are consistent; format mockup approved by the owner.
- [ ] Calculation figures are identical across related export paths where they represent the same result.
- [ ] PASS / WARNING / FAIL / NOT CHECKED / DATA REQUIRED states are consistent and complete.
- [ ] App version raised for the phase.
- [ ] Tables have readable labels, units, and page breaks.
- [ ] Long PDF contents/bookmarks and page numbers resolve correctly.
- [ ] Drawing symbols remain clear at the intended page scale and in grayscale.
- [ ] Incomplete manufacturer/reference data is explicitly identified.
- [ ] Current versus stale calculation state is apparent in every relevant report.
- [ ] Existing PDF, calculation, lint, typecheck, and build tests pass.
- [ ] Before/after PDF samples and any known limitations are documented.

### Required deliverables after each phase

- Changed-file summary and rationale.
- Before/after sample PDFs for affected document types.
- Automated test results and rendered-PDF review notes.
- List of replaced/deprecated implementations with evidence of output parity.
- Remaining risks, exceptions, and owner decisions required.

---

## Recommended first instruction to Claude Code

> Read `docs/LV_Design_Studio_PDF_Optimization_Plan.md`. Inspect the current repo and confirm the complete PDF-export inventory. Then show me a mockup of the black-and-white format before changing any exporter. After I approve it, implement **Phase 1 only**: one shared print-token stylesheet, colour removed, and `printDoc.ts` users moved onto the `reportFrame.ts` frame. Preserve all existing PDF output types, engineering calculations, status labels, authority forms, and drawing scale. Produce before/after PDF samples and run PDF/rendering tests. Do not push changes without approval.
