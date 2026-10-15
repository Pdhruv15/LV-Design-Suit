# Phase 5 — bookmarks, regression tests, export centre

**Date:** 15 October 2026 · **Version:** 1.43.0

## 1. Bookmarks (PDF outline)

The export pipeline (`renderPdf`) accepted bookmarks, but no document passed any, so long reports opened with no bookmarks panel.

- Section headings now carry a marker: `<a class="dest" href="#id" data-bm="Title">` (`src/docs/outline.ts`). Chrome records each section's page, and `renderPdf` turns every marker into a bookmark when a document gives none of its own.
- Covered:
  - **Study report:** document control, contents, numbered sections, results, appendices.
  - **Calculation report:** results summary, full attention list, design basis, each section, assumptions, calculation record.
  - **Voltage drop report:** one bookmark per panel.
- The BOQ keeps its own bookmarks, and merged packages keep one per part.
- `tests/pdf/outline.pdf.ts`: through Electron, one bookmark per marker, on its page, in order.

## 2. Image-level layout regression

- `tests/pdf/visual.pdf.ts` prints every sample document through the app's Chromium call and rasterises the first three pages with pdf.js inside Electron (`tests/pdf/rasterize.cjs`). It then compares them with baselines in three steps: page count, page sizes, then pixels (pixelmatch, at most 0.2 % differing). A failure names the page and writes a diff image.
- Baselines are per platform (`tests/pdf/baselines/darwin/`). The date and app version are fixed, so a new day or a version bump does not change the pictures.
- `npm run test:pdf:update` rewrites the baselines after an intended layout change.
- Checked: an unchanged run matches exactly. A 0.5 pt table font change fails four documents.
- Dev dependencies only: pdfjs-dist, pngjs, pixelmatch, @types/pngjs. They add no audit advisories.

## 3. Export centre (Reports → Export centre)

- Lists every PDF document in the seven plan groups (21 entries, `src/components/docs/exportCatalogue.ts`). Each one is built by the same functions as its own page, with the settings saved in the project.
- Tick documents, then export either:
  - a zip of PDFs, or
  - one PDF with a bookmark per document.
- Documents that use calculation results are disabled until the calculations are run and current. Documents with nothing to export say why ("No UPS system entered").
- Drawings (SLD and circuit sheets) and the issue package stay on their own pages, because they need the drawing canvas. The study report here is exported without its SLD sheets.
- Desktop app only for PDF; the browser version says so.
- Tests:
  - `exportCatalogue.test.ts`: every available entry builds, the run and stale rules hold, and the input-dependent entries build once their inputs exist.
  - `tests/pdf/exportCentre.pdf.ts`: all available documents printed and merged, all pages kept, one bookmark each.
