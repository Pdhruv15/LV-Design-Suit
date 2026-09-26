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

## Tests

```bash
npm test
```

Unit tests (Vitest) in `src/**/*.test.ts` check the calculation engine
against hand-worked values and cover the OpenDSS exporter.

## Calculation engines

The built-in TypeScript engine (`src/calc/`) drives the live UI. External
engines plug in behind the `CalcEngine` interface in `src/engines/types.ts`.

**OpenDSS cross-check:** *Reports → Export OpenDSS (.dss)* writes the network
(transformer, busbars, feeder cables, loads, PV) as a self-contained OpenDSS
script that runs a load flow and a fault study. Open it in
[OpenDSS](https://sourceforge.net/projects/electricdss/) to compare its
results with the app's. The modelling assumptions are listed in the header
of the exported file.

## What's real vs. what's next

**Working now:**
- Data model (`src/types.ts`) — boards, feeders, cable, breaker fields
- Calculation engine (`src/calc/electrical.ts`, `cableTable.ts`):
  - design current and ambient-derated ampacity
  - voltage drop per feeder **and cumulative from the source**, which is the
    value checked against the limit
  - overload protection check Ib ≤ In ≤ Iz (IEC 60364-4-43)
  - fault levels from R+jX impedance: at the breaker's busbar (checked
    against Icu) and at the cable end
- Editing feeders and boards from the UI, multi-level board hierarchy,
  cable-size suggestion that respects the breaker rating and the voltage-drop
  budget left after upstream drops
- BOQ CSV export and OpenDSS script export
- Project save/load as JSON, Drive-sync friendly

**Not built yet — natural next steps:**
- Running OpenDSS or pandapower directly from the app and comparing results
  side by side
- Earth-fault loop impedance (Zs) and disconnection-time check
- Grouping/installation-method correction factors for cable sizing
  (only ambient temperature is modelled right now)
- PDF calculation report; DEWA panel schedule export
