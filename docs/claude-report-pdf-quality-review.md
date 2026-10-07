# Claude review request: calculation reports and PDF output quality

Please independently review report generation in this repository. Check the findings below against the current implementation, investigate other material defects, and report your conclusions **before making changes**.

## Task context and boundaries

- Project: LV Design Studio, an offline React/TypeScript/Electron application for LV electrical design.
- Repository: `/Users/palanisamigovindasamy/Projects/LV-Design-Suit`.
- That absolute path identifies this machine's checkout. If reviewing elsewhere, use the equivalent repository root; source paths below are relative to it.
- Handoff date: 3 October 2026, Asia/Dubai.
- This is a **read-only review**, not an implementation request.
- Do not modify application code, project data, tests, dependencies, or configuration. Do not commit, reset, discard, or overwrite existing work.
- Read applicable repository instructions first. Inspect the current worktree; other work may be in progress.
- During handoff preparation, unrelated changes were observed in `src/components/FeederForm.tsx`, `src/types.ts`, and an untracked `src/model/moveBoard.ts`. Preserve any current work. Recheck status rather than assuming this list remains current.
- Do not generate PDFs, screenshots, fixtures, or other files until the user authorizes temporary QA artifacts. You may inspect existing artifacts and perform calculations in memory without saving files.
- Do not treat this preliminary audit as proof. Confirm, reject, or qualify each finding using the current code and reproducible evidence.
- If deciding whether an electrical method or standard is correct requires external verification, use authoritative sources. A disagreement between a displayed method and the evaluator establishes inconsistency, not which threshold is technically correct.

## What to review

Review both the **content** and the **generation pipeline**, not just the appearance of the page where Export is clicked.

1. Core electrical calculation report and all nine Study Reports sections: short circuit, load flow/voltage drop, cable/breaker sizing, earthing, discrimination, transformer/generator sizing, PFC, busbar risers, and DB/cable schedules.
2. Standalone voltage-drop, PFC, transformer/generator, busbar, UPS/battery, solar, containment, and other calculation outputs. Identify missing export coverage for motor-start checks, quick calculators, and selection recommendations.
3. DB load schedules, MD forms, transformer TCL summaries, riser forms, cable/tray/equipment schedules, building and substation documents, and space planning.
4. Dashboard summaries, full/summary BOQs, drawing sheets, drawing registers, revision comparisons, transmittals, and combined submission packs.
5. Shared HTML-to-PDF rendering, page-size/orientation handling, metadata, page numbers, bookmarks, merging, error reporting, and cancellation.

Check that each export uses the intended scope and the correct project/calculation snapshot. Compare visible application values with exported figures, inputs, status counts, recommendations, methods, and assumptions. Invalid or unavailable calculations must not disappear or become passing results.

## Preliminary findings to verify

Source locations below are starting points. Line numbers may move; locate the named functions in the current checkout.

### 1. High: report exports can retain old inputs without being marked stale

**Starting points:** `src/calc/runs.ts` (`INPUTS`, `fingerprint`, `staleStudies`); `src/components/docs/StudyReportsView.tsx` (`calc`, `data`, `blocked`); standalone study components.

Study Reports builds sections from `run.project`. The stale-input fingerprints appear to omit report-affecting inputs such as `pfc`, `txGen`, `busRisers`, `busbarData`, `vdTempC`, and board ratings. Non-calculation information such as names, remarks, project details, logos, and revision metadata can also be old because exports use the saved project snapshot.

**Prior in-memory checks:** after `runCalculations(sampleProject)`, editing only `pfc.stepKvar`, `txGen.sizeList`, or a feeder's `cableType` returned `[]` from `staleStudies`. A control change to `loadKw` correctly marked studies stale.

Verify which omitted fields affect results, which affect descriptions only, and which exports actually use old values. Propose a consistent policy for calculation snapshots versus current report metadata; do not assume every descriptive edit needs recalculation.

### 2. High: the main Calculation Report and study pages use different sizing paths

**Starting points:** `src/docs/report.ts` (`buildReportHtml`); `src/calc/sizing.ts`; `src/calc/txGen.ts`; `src/calc/pfc.ts`; `src/components/studies/SizingStudy.tsx`; `src/components/studies/PfcStudy.tsx`.

The main report calls `sizeTransformer`, `sizeGenerator`, and `sizePfc`. Dedicated study pages use `sizeTransformers`, `sizeGeneratorByBoards`, and `planPfc`.

Check whether the main report respects the selected transformer size list, per-board sizing, duty/standby, generator board shares, motor-start demand, PFC strategy, and capacitor step settings. Demonstrate any disagreement using the same project and distinguish intentionally different summaries from incorrect recommendations.

### 3. High: generators above the supported range can disappear from sizing reports

**Starting points:** `src/calc/txGen.ts` (`sizeGeneratorByBoards`); `src/calc/sizing.ts` (generator sizes); `src/docs/studyReport.ts` (`buildSection`, sizing branch).

When `recommendedKva` is undefined, the report appears to omit generator status, summary, and generator tables. This conflates no generator demand with demand exceeding available sizes.

**Prior in-memory reproduction:** a single main board with a 3,000 kW, PF 1 load selected at 100% for the generator produced a 3,750 kVA running design requirement and no recommendation. The exported section model contained only the Transformers table and no generator summary.

Verify the cover/result counts too. The report should explicitly retain the requirement and explain that no standard size fits.

### 4. High: an unsizeable busbar can show zero voltage drop and Pass

**Starting points:** `src/calc/busbar.ts` (`sizeRiser`, `riserVd`); `src/docs/voltageDropReport.ts`; busbar Study Reports section.

`riserVd` appears to substitute zero impedance when no busbar type is selected, then determines status from the resulting drop alone.

**Prior in-memory reproduction:** a riser supplied from a root MDB, with a 100 kW floor load, 20 m feed, and an empty busbar catalogue, had no selected type but returned zero segment drops, `exactTopPct: 0`, and `status: 'ok'`.

Check how all report paths present this invalid result and whether upstream voltage drop masks or exposes the problem. Compare the busbar-sizing report with the voltage-drop report.

### 5. High: DB load-schedule totals can disagree with displayed rows

**Starting points:** `src/docs/loadScheduleDoc.ts` (`loadScheduleRows`, `buildLoadScheduleHtml`, `loadScheduleCsv`); `src/calc/loadSchedule.ts` (`circuitWatts`, `boardPhaseKw`); `src/docs/dbSheet.ts`.

Rows show connected point watts. Totals use `boardPhaseKw`, which applies demand factors and includes other or downstream feeders that may have no printed schedule row.

**Prior in-memory reproduction:** one R-phase circuit with 10 lighting points at 100 W each, `loadKw: 1`, and `demandFactor: 0.5` printed 1,000 W in its row but produced a 500 W total.

Check PDF, CSV, and Excel/model behavior. Review connected versus demand totals, phase allocation, rounding, imbalance, and unscheduled loads. Separate differently defined totals instead of silently mixing them.

### 6. High: voltage-drop exports omit motor-start results

**Starting points:** `src/calc/voltageDrop.ts`; `src/components/studies/VoltageDropStudy.tsx`; `src/docs/voltageDropReport.ts` (`VD_HEADERS`, `vdCells`); load-flow Study Reports section.

The application calculates and highlights motor-start voltage drop, but standalone report columns appear to contain running results only.

Construct a motor case that passes running drop but exceeds the configured starting limit. Check whether the PDF/CSV and combined study report preserve starting drop, its limit, its status, and the distinction between starting and running checks.

### 7. High: BOQ PDFs do not adequately disclose incomplete or provisional pricing

**Starting points:** `src/model/priceList.ts` (`priceBom`); `src/docs/boqWorkbook.ts` (`buildBoqHtml`, workbook builder); `src/components/docs/BomView.tsx`.

The pricing model records missing rates, illustrative fallback rates, and quantity overrides needing review. The PDF appears to print totals without equivalent flags. A selected price list may be named in the header even when some rates come from fallback data; the summary-only PDF hides the detailed unpriced items.

Compare the full PDF, summary PDF, Excel workbook, and application. Verify how unpriced, excluded, fallback-priced, and changed-quantity items affect totals and are described to the reader.

### 8. Medium: incoming cable descriptions are hardcoded in DB schedules

**Starting points:** `src/docs/loadScheduleDoc.ts` (incomer text and cable footer); `src/docs/dbSheet.ts`; `src/model/cableTypes.ts`; shared cable/pole label helpers.

The PDF footer always describes one cable plus one ECC with `CU/XLPE/SWA/PVC`. It appears to ignore parallel runs and supported constructions such as fire-rated or LSZH cable. The incomer label always adds TP&N even though two-core feeders are supported.

Verify labels against actual feeder data and compare PDF, Excel, cable schedules, and SLD descriptions.

### 9. Medium: dashboard PDFs can mix current figures with previous-run statuses

**Starting points:** `src/calc/dashboard.ts` (`buildDashboard`); `src/docs/dashboardPdf.ts`; `src/components/docs/ProjectDashboard.tsx`.

Dashboard figures are derived from the current project while study pass/fail counts can come from the last run. Export remains enabled when calculations are stale. The PDF can therefore show current loads alongside an old All pass result. The stale warning is reportedly in a to-do list limited to nine items.

Verify the standalone dashboard and the dashboard included in a submission pack separately. Determine whether freshness remains visible independently of the to-do list.

## Additional consistency checks

- **Scoped generator sizing:** transformer rows are filtered by report scope, but generator sizing and its load rows appear global. A shared generator may legitimately need global sizing; identify that scope explicitly instead of presenting out-of-scope boards without explanation.
- **Scope selection and saved sets:** `scopeOf` filters unknown board IDs and falls back to the whole installation when no valid IDs remain. Check deleted-board presets and clearing the last selected board.
- **Methods versus implementation:** compare the earthing final-circuit threshold stated in the report with the evaluator, and the main report's stated `1.2 × R20` assumption with configurable `vdTempC`. Report inconsistencies without asserting regulatory correctness from code alone.
- **Revision comparison:** inspect field allowlists in `src/model/revisions.ts`. Check whether changes to parallel runs, tray routes, instantaneous settings, essential/standby flags, capacitor sizes, demand factors, building/tray/riser data, and UPS/PV inputs appear in change outputs.
- **Drawing sheets:** confirm that scoped sheets retain whole-network calculation results, DB circuit sheets do not use stale feeder data, and manual paper size does not suppress readability warnings. Check cable-schedule consistency between ordinary PDF and ZIP exports.
- **Registers:** compare resolved paper sizes, issue-history completeness, and document/person fields across PDF, Excel, and combined drawing sets.
- **Export behavior:** compare error handling for Excel with PDF/Word, multi-file cancellation, output filenames including scope/revision, and whether unsupported desktop-only exports explain their requirements before execution.

## Visual quality risks: not yet confirmed by rendered PDFs

Do not report these as observed clipping or pagination defects without inspecting actual rendered pages.

| Risk | Starting point | Verification needed |
| --- | --- | --- |
| Dense tables on A4 | `voltageDropReport.ts`, `report.ts`, `schedules.ts`, `loadScheduleDoc.ts` | Long IDs/descriptions, 18-column voltage-drop tables, numeric widths, minimum font size, wrapping, repeated headers |
| Large cable-tray routes | `trayReport.ts`, `traySection.ts` | Fixed-width diagram beside table, long route blocks, continuation pages, table/diagram alignment |
| Claimed one-page summaries | `dashboardPdf.ts`, `buildingSummary.ts`, `dmForm.ts` | Many transformers/floors, long notes, footer overlap, actual page counts |
| Portrait/landscape consistency | Export callers, `src/util/files.ts`, `electron/main.cjs` | Some portrait HTML templates use callers that omit orientation/CSS-page options; verify actual installed Electron behavior |
| Long footer labels | `pdfTools.ts` (`stampPages`) | No width limit or wrapping; check long project/report names and page margins |
| Study diagrams | `studyReport.ts`, `StudyReportsView.tsx` | Fixed A3 diagrams, large/deep networks, legible annotations, complete legend and symbols |
| Drawing furniture | `sldSheet.ts`, `sheetRender.tsx` | Notes, cable schedules, legend overflow, custom title blocks, revision history, available drawing area |
| Images and special characters | All templates and PDF pipeline | Logos, electrical units/symbols, Unicode names, font substitution, image proportions |
| Combined submissions | `mergePdf.ts`, submission builders | Mixed page sizes/orientations, bookmarks, consistent numbering, blank pages, duplicated footers |

## Export coverage to inventory

Preliminary review suggests these gaps. Verify them rather than assuming they are intentional defects:

- MD, transformer TCL, and busbar riser authority forms expose Excel exports without dedicated PDF exports.
- Space planning lacks a document export.
- Standalone DB/cable/equipment schedule pages primarily offer CSV; some schedules appear inside larger reports.
- UPS and solar have standalone PDFs but are absent from the combined Study Reports selection.
- Quick Calculators lack PDF output; cable-selection recommendations lack a current-versus-recommended export.
- The submission PDF includes dashboard, chosen studies/SLDs, and DB load schedules, but not all authority forms.
- Word omits study SLDs, and Excel exports tables; check that the Output UI describes format differences.

Distinguish a **missing feature** from an **incorrect existing export** when prioritizing.

## Evidence and validation limitations

- The previous audit inspected generators and export callers, plus existing test sources.
- Four issue categories were reproduced in memory: missed stale detection, load-schedule total mismatch, omitted above-range generator, and passing voltage drop without a selected busbar.
- No sample PDFs were available in the repository during that audit. No PDF files or rendered page images were generated.
- Existing tests mostly check calculations, strings, tables, workbook structure, or synthetic PDF merge/bookmark behavior. They do not by themselves prove actual Electron-rendered page quality.
- Do not claim the current full test suite passes unless you run it and record the result. Check whether tests write artifacts before executing them under this read-only request.

## What to return to the user

Return the review in chat first; do not implement fixes or save another report file without authorization.

1. A concise verdict on report correctness, completeness, and visual quality, keeping verified and unverified conclusions separate.
2. A table for every preliminary finding: **Confirmed / Rejected / Partially confirmed / Needs rendered QA**, severity, current source reference, reproduction/evidence, impact, and proposed correction.
3. Any additional material defects, without duplicating overlapping findings.
4. A coverage matrix showing each calculation/document type, available formats, scope/freshness behavior, and gaps.
5. A prioritized implementation proposal with small, reviewable batches and meaningful regression checks.
6. A proposed rendered-QA matrix for small, typical, large, long-text, invalid/missing-data, stale, and scoped projects. Before generating temporary artifacts, explain exactly what would be created and obtain user authorization.

Prioritize trustworthy data and complete failure reporting, then output consistency and readable page layout. Preserve the application's current design unless a change is necessary to address an agreed problem.
