# BIM integration (3D) — for later

Noted 2026-10-21. **Not now:** the CAD link stays **2D plan only** until the user decides otherwise.

## Why later
Floor plans received from architects and clients are 2D: layers, blocks, lines, outlines and text. They carry no
reliable third dimension. Some drawings write elevations as text, but that is not dependable enough to read.

## Today (2D, OpenCADStudio link, v1.59–v1.65)
- Room areas from closed outlines / hatches; names from room tags or texts (Rooms and areas from CAD floor plan).
- Cable route **plan** length; the vertical part is a manual allowance (project setting, per-feeder override).
- Board positions are x, y on the plan; the level is chosen by the engineer.
- Plan: `docs/plans/opencadstudio-two-way-link-plan.md`.

## What a BIM link (Revit, IFC) could add
- Real elevations: floor-to-floor heights, ceiling and tray heights → vertical cable lengths instead of an allowance.
- 3D cable tray and conduit routes with fittings (bends, risers) → exact lengths and tray BOQ.
- Rooms / spaces with level, area **and volume** directly from the model (no layer mapping).
- Equipment with parameters (load, phase, board) read from family / IFC properties.
- Levels from the model → Building information without retyping.

## Open questions
- Revit (API / add-in, Windows) or IFC files (open, any BIM tool) first?
- Which parameters do consultants put on electrical families?

Up: [[Future development]]
