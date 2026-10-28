---
title: CAD basics in Rust — open natively, measure, area, add devices
date: 2026-10-28
status: future-development
decision: mockup approved 2026-10-28; step 1 (open natively) built, v1.90
tags:
  - future-development
  - CAD
---

# CAD basics in Rust — open natively, measure, area, add devices

User, 2026-10-28: the current Floor plan page is not what was expected. Build our own 2D CAD functionality in Rust (no
3D), replacing the floor plan module — but **only the basics**, added one by one on request:

1. **Open natively**, like a CAD program: model space, crosshair, live coordinates, snaps, pan / zoom, layers, blocks
   drawn as drawn.
2. **Measure** lengths (DI) with snaps.
3. **Check area** (AREA): snapped corners, a closed outline, or click inside a room.
4. **Add devices** (DEV): place symbols (lights, sockets, DB, ELV) with their circuit, snapped; move / delete.

Later, when asked: drawing / editing, dimensions, plotting, submission sheets.

Mockup: [cad-basic-mockup.html](../../mockups/cad-basic-mockup.html).

## Decisions so far (2026-10-28)

- **Rust engine, not a whole-app rewrite.** The CAD core (entities, blocks, snaps, hit-testing, undo, DXF / DWG I/O) is a
  Rust crate compiled to WebAssembly — same in the desktop app and the web version. Ribbon, panels and the rest of the
  app stay TypeScript / React. A full Rust rewrite was advised against (large working app, 2,100+ tests, little gain).
- **Formats.** acadrust (MPL-2.0) reads and writes DWG R13–2018; no licence issue. Open DWG / DXF; **save DXF** first;
  Save as DWG only after round-trip tests on real consultant drawings.
- **Timing with AI writing it:** basics in days per step, not months; the limit is review and testing on real plans
  (the app is not launched by the agent — AGENTS.md).

## Proposed (in the mockup)

- A **CAD** ribbon tab: File (Open, Save DXF) · Measure (Distance, Area, Room area) · Devices (Add device, Move,
  Delete) · View (Layers, Fit, Undo).
- Model space with crosshair, coordinates (top-left), snap marker and its name (Endpoint, Midpoint, Intersection,
  Perpendicular, Centre); a **command line** (DI, AREA, DEV, Esc) and a **status bar** (SNAP, OSNAP, ORTHO, GRID).
- Right panel: **Result** (length / ΔX / ΔY; area / perimeter, "Add as room…"), the **device palette** with circuit
  and layer, and **Layers** on / off.
- Replaces the Floor plan page once it does what that page does (rooms, routes, trays and boards come back as CAD
  commands when asked).

Up: [[Future development]]
