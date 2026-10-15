# Phase 3 — consolidation of registers, transmittals and drawings

**Date:** 15 October 2026 · **Version:** 1.41.0

## Owner decision

Drawings keep their functional colour: the result colouring on the study-report SLDs and the earthing-schematic conductors. Only the red revision circle on SLD sheets is now black.

## What changed

- **One transmittal.** A drawing issue now prints through the document transmittal (`buildTransmittalHtml`), from its submission record:
  - `submissionForIssue()` uses the submission recorded for that issue (with its address, attention and remarks) if there is one;
  - otherwise `issueAsSubmission()` builds the record from the issue itself. This is the same mapping the submission register already used.

  The old `transmittalHtml` in `model/drawingSet.ts` is removed. The transmittal now has a Subject row (the issue description), and its headings say drawing or document as appropriate.
- **Drawing register** moved to `src/docs/drawingRegister.ts` and onto the shared `printDoc` frame: running header, footer and page numbers. The content is unchanged: project block, drawings, last eight issues.
- **SLD sheet:** the revision-note circle is black instead of red.

## Already single-source (no change needed)

- DB, cable and equipment schedules all come from `schedules.ts`, in the schedule PDF, the study report and the calculation report.
- The MD, TCL and riser forms all come from `formWorkbook.ts`, in the workbook PDF and in Excel.
- The drawing package (`sheetRender.tsx` + `mergePdf.ts`) already exports single sheets or a merged set with the register.

## Detail dropped

The drawing transmittal no longer has its own "Owner / client" row. The project line still names the project, plot and area.

## Samples

`before-*` (v1.40) and `after-*` (v1.41) of the drawing register and drawing transmittal.
