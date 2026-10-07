---
created: 2026-10-04
updated: 2026-10-04
tags: [cad-export, verification]
---

# DXF export verification — 2026-10-04

Checkout: `codex/dxf-export-quality`, based on `ac3774a`. Local commits `51a4bc9` and `bcb3afe` (LibreCAD SOLID-width correction). Local source build, not the installed production app. User requested local-only changes; nothing pushed and no PR created.

## Automated evidence

- `npm test`: **110 test files, 792 tests passed** after the SOLID correction (initial run: 786 passed).
- `npm run typecheck`: passed.
- `npm run build`: passed. Existing bundle/chunk warnings remain.
- 43 new tests cover writer SOLID width/corner order/joins/Fit/rotation/anchors/extents, curve shape and error, real XML conversion, three adjacent feeders, parallel armoured cables, CT meter clearance, RCD, socket arc, full/reference labels, and A4/A3/A2/A1 paper scaling. Large-drawing tests cover 40,000 fitted labels and 160,000 polyline vertices; extents are accumulated iteratively.
- Browser fixture uses the actual React SystemDiagram, app CSS, printableSvg, svgToDxf, toDxf and buildSheetDxf pipeline. PASS: live diagram unchanged; busbar width retained; all visible text measured; RCD oval retained; cable labels bounded.

## Native CAD check

Installed and opened official ARM64 LibreCAD 2D build `v2.2.1.5-57-gb8f7efe12` at `/Applications/LibreCAD.app`, as requested. Installer SHA-256 and application signature verified.

The initial wide-POLYLINE sample still displayed a thin busbar in LibreCAD. The writer was corrected to emit filled R12 SOLID geometry. Opened `DXF-clearance-final.dxf` and used Auto Zoom: the red busbar now displays with visible thickness; adjacent cable/ECC labels, CT meter clearance, curved glands, RCD oval and socket curve are visible. Screenshot below records the result. A3 and other sheet scales were tested automatically; the final A3 file was generated but not separately inspected in native CAD.

AutoCAD was not used to verify the result. This is a native LibreCAD sample check, not verification of every possible project annotation.

## Test files

- [[Assets/DXF export/DXF-clearance-final.dxf|Final diagram DXF]]
- [[Assets/DXF export/DXF-clearance-final-A3.dxf|Final A3 sheet DXF]]
- [[Assets/DXF export/DXF-clearance-check.svg|Printable SVG source]]
- ![[Assets/DXF export/browser-check.jpg]]
- ![[Assets/DXF export/librecad-final.png]]

Earlier comparison: ![[Assets/DXF export/librecad-before-width-fix.png]]

The source project is `tests/fixtures/dxfExport.ts`. The local browser fixture is `Assets/DXF export/qa.html` (serve with Vite); it is not shipped with the app.

Issue record: [[DXF export issues and solutions]].
