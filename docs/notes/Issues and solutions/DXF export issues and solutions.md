---
created: 2026-10-04
updated: 2026-10-04
tags: [cad-export, sld, issues]
---

# DXF export issues and solutions

User reported overlapping cable marks/text and thin red busbars in an AutoCAD screenshot on 2026-10-04. Corrections are verified on local branch `codex/dxf-export-quality`. The user requested that changes stay local: no GitHub push or PR. The installed LV Design Studio has not been updated.

| ID | Confirmed cause | Correction | Verification |
|---|---|---|---|
| DXF-001 | SVG busbar stroke width discarded; LibreCAD also ignores imported classic POLYLINE widths | Filled R12 SOLID busbar geometry on existing red BUSBAR / E-BUSBAR layer; preserve source width, sheet scale and coupler links | Verified visibly thick in LibreCAD; writer, transform and A4–A1 scale tests pass |
| DXF-002 | Quadratic cable glands and socket arcs exported as endpoint chords | Sample quadratic/cubic/elliptical curves into polylines, target error ≤0.2 source units with bounded output | Curve tests pass; glands and socket curve visible in LibreCAD |
| DXF-003 | CAD font footprint uncontrolled, long labels cross adjacent feeder columns; first cable baseline almost touches glands | Measure live text lengths, emit R12 TEXT Fit, cap feeder text to neighbouring drop; add 3-unit CAD-only cable clearance | Adjacent-feeder full/ref tests pass; sample cable labels visibly separated in LibreCAD |
| DXF-004 | Cable text collides with local kWh/CT metering | CAD-only cable offset reserves the meter box and CT lettering; same offset on ECC and reference-length lines | CT/full/ref tests pass; native sample clears CT meter |
| DXF-005 | SVG ellipse unhandled; RCD oval absent in DXF | Closed polyline approximation retains the RCD oval in R12 | Geometry/browser tests pass; oval visible in LibreCAD |

No colours, controls, icons or live/PDF diagram positions changed. DXF remains ASCII AutoCAD R12 (AC1009); wide geometry gives visible busbar emphasis without relying on lineweight-display settings. Full cable data remains editable text; narrow columns can compress long labels, so cable-reference mode remains useful for dense drawings.

Detailed evidence: [[DXF export verification - 2026-10-04]].

Scope limits: this corrects the reproduced feeder/gland/busbar output. It is not a universal collision solver for arbitrary annotations or authority approval. MDB/SMDB engineering calculations and international profiles are unchanged.
