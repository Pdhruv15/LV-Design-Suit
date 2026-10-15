# Phase 4 — validation and status integrity

**Date:** 15 October 2026 · **Version:** 1.42.0

Exit criterion: no failed or unverified result is silently shown as PASS or left out.

## Audit

- **Stale results.** Almost every export calculates live from the current design, so it cannot be out of date:
  - schedules, load schedules, PFC / UPS / PV / containment / tray / enclosure calculators, demand forms, drawings and the calculation report.

  The exports that print a stored calculation run already handle staleness:
  - study reports: a pre-export error while the results are out of date;
  - calculation report: export disabled until the calculations are run;
  - voltage drop, project summary and review: they show their stale state.
- **Status integrity.** I gave one circuit (DB-EV) an installation method with no built-in rating. In every document it is DATA REQUIRED where Iz is needed, never PASS, and FAIL overall. Its PASS results are only for checks that do not use Iz: voltage drop, breaking capacity and earth fault loop.

## Changes

- **Nothing left out of the summaries.** When there are more than 10 items, the calculation report and the voltage drop report keep their page-1 box of the first 10 and add an "Items needing attention (all N)" table after it, listing every one.
- **Pre-export check on the calculation report.**
  - The calculation report page runs the same `validateReport()` as the study reports: stale or missing results, failures, data required, broken tables, invalid numbers, missing references and implausible units.
  - The findings appear above the preview. The panel opens automatically when there are errors.
  - Export asks for confirmation while errors remain.
  - The "Project data" warnings are left out, because this report has no cover and leaves prepared / checked / approved blank for signing.
- `calcReportData()` shares one calculation between the report and its check.

## Tests

- `statusIntegrity.test.ts` checks the circuit without a rating:
  - it is never PASS where Iz is needed, in the calculation report, study report or cable schedule;
  - it is listed as needing attention in the calculation report and the issue package;
  - it is a pre-export error.

  The test fails (3 of 5) if the cable table shows PASS for a missing rating.
- The attention-list tests now require the complete list to match the count.

## Sample

`after-calculation-report.pdf`: 29 pages. Page 2 lists all 32 items needing attention.
