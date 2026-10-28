# ELV module boundary — decision

**Decided 2026-10-28 (user):** ELV stays in **one repo and one app** with LV, as a separate module with a hard boundary. No separate ELV repository or desktop app for now. This closes the "separate repository or monorepo sibling" question in the LV ELV architecture proposal (2026-10-25).

## Why

- ELV reuses the shared core: projects, buildings, levels and rooms, CAD/DWG rooms, floor plan, exchange contracts, reports, CLI/MCP, installer and auto-update. A second app would duplicate all of it.
- ELV and LV already talk only through a loads package (ELV estimate → review inbox → placement on LV boards).
- A separate app can still be built later from this repo (for example a `build:elv` target or a module switch) without a repo split.

Revisit a separate repo only if ELV gets its own team, its own release cadence, or is sold to users who never use LV.

## The boundary (enforced by `npm run lint`, `eslint.config.js`)

| Side | Files | May import |
| --- | --- | --- |
| **ELV design** | `src/elv/**`, `src/components/elv/ElvView.tsx` | Shared core only: `types`, `calc/building` (rooms), `exchange`, `util`, `components/ui` |
| **LV** | the rest of `src/` | Not ELV internals (`src/elv/**`). Type-only imports allowed (`Project.elv` settings). Accepted ELV loads are read with `acceptedElvLoads` in `src/exchange/inbox.ts`. |
| **Wiring** | `src/App.tsx`, `src/headless/**`, tests | Both |

Placing accepted ELV loads on LV boards is LV work, so it moved to `src/calc/elvPlacement.ts` and `src/calc/elvPlace.ts`. The review inbox and Place ELV dialog (`src/components/elv/InboxView.tsx`, `PlaceElvDialog.tsx`) are LV-side screens in the same folder; no visible change.

## Next ELV steps (each one PR, approval first)

1. Authority rule sets per project: DCD Fire and Life Safety Code, SIRA (follow-up 4).
2. Fire alarm engineering: loop loading, battery Ah to BS 5839-1 Annex E, loop voltage drop.
3. Device placement on the 2D floor plan (mockup first).
4. ELV BOQ and riser schematic reports, black-and-white (mockup first).

Up: [[Future development]]
