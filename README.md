# LV Design Studio (v0.1 — working scaffold)

An offline desktop app for LV electrical design: single-line diagram, voltage
drop, cable sizing, short-circuit and discrimination checks, and project
files saved as plain JSON so they sync cleanly through a Google Drive /
OneDrive / Dropbox desktop folder.

This is a real, running scaffold — not a mockup. The calculations in
`src/calc/` are genuine formulas (IEC 60228 cable resistance data, IEC
60364-5-52 ambient derating, standard voltage-drop and fault-current
equations), not fake numbers. Treat the reference cable/ampacity table as a
starting point to replace with your manufacturer's datasheets or exact
DEWA/IEC tables before relying on it for real projects.

## Setup

Requires [Node.js](https://nodejs.org) 18 or later.

```bash
cd lv-design-studio
npm install
npm run dev
```

This opens the app in an Electron window with a sample project loaded
(the same villa-complex scenario from the earlier mockup, now computed for
real). Click any feeder in the diagram or table to see its properties.

## Saving projects to Google Drive

On first run the app creates `~/LV Design Studio Projects`. Click the
**projects folder** button in the left sidebar and point it at a folder
inside your Google Drive desktop-sync folder (e.g.
`~/Google Drive/My Drive/LV Projects`). Every "Save" writes a plain `.json`
file there, which Drive then syncs automatically — no login or API needed
inside the app itself.

## Building an installer

```bash
npm run dist
```

Produces a `.dmg` (mac), `.exe` installer (Windows), or `.AppImage` (Linux)
in `release/`, depending on the platform you build on.

## What's real vs. what's next

**Working now:**
- Real data model (`src/types.ts`) — boards, feeders, cable, breaker fields
- Real calculation engine (`src/calc/electrical.ts`, `cableTable.ts`) —
  design current, ambient-derated ampacity, voltage drop, transformer +
  cable fault impedance, discrimination check
- Single-line diagram, tables, and properties panel all driven by that
  engine — nothing in the UI is hardcoded/fake anymore
- Project save/load as JSON via native file dialogs, Drive-sync friendly

**Not built yet — natural next steps:**
- Editing feeders/boards from the UI (currently edit `sampleProject.ts` or
  the saved JSON directly to change the network)
- Adding/removing boards (multi-level MDB → SMDB → DB hierarchies)
- Grouping/installation-method correction factors for cable sizing
  (only ambient temperature is modelled right now)
- BOQ / report export
- Revit/BIM export, matching your DEWA panel schedule format
