# Phase 2 — one calculation-report source

**Date:** 15 October 2026 · **Version:** 1.40.0

## Decision (owner)

Keep the compact standalone Calculation report: page-1 document block, results summary, needs-attention list and design basis. Every section after page 1 is built from the study report's own sections.

## What changed

- New `src/docs/calcReport.ts` builds the calculation report. Its sections come from `buildSection()` (`studyReport.ts`) for load, sizing, cable, lf, sc, earth, disc, pfc and schedules, on one calculation of the whole network. The old hand-built tables in `report.ts` are gone: system summary, feeder, earthing, coordination and schedules.
- The page-1 "Needs attention" list now comes from `unresolvedChecks()`, the same list as the issue package. The 10-item cap is unchanged; making the list complete is a Phase 4 item.
- `report.ts` now holds only the shared plain-document pieces: `esc`, `tally`, `PLAIN_CSS`, `REPORT_CSS` and `reportHead`.
- `studyReport.ts` exports its table renderers (`tableHtml`, `kvHtml`, `cellHtml`) so both reports print tables the same way.

## Parity (exit criterion)

`src/docs/report.test.ts` checks that, for the same project:

- `calcReportSections()` deep-equals the study report's sections;
- every study-report table appears unchanged in the calculation report.

The tests that checked the old report's wording now check the shared wording. They still cover the same things:

- the per-CPC parallel runs;
- the "not verified — supply loop incomplete" note;
- the recommended transformer and generator sizes;
- every section heading.

## Samples

- `before-calculation-report.pdf`: v1.39, 15 pages.
- `after-calculation-report.pdf`: v1.40, 26 pages. The extra pages are content the study sections carry that the old report did not:
  - load assessment, load flow and PFC sections;
  - input, design criteria and method for each section;
  - verification tables.

  No table overflows.
