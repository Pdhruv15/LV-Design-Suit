# Status

_Last updated: 2026-10-13_

## Current development focus

- **Dubai / DEWA first** — engineering calculations, load schedules, SLDs and submission quality.
- International / India / additional-authority support is **on hold until explicit user confirmation**. Research is saved in [[International authority profiles - review - 2026-10-04]] under [[Future development]]; do not begin implementing that proposal now.

## Done (on main)
- Building reuse (branch `building-presets`): Building → Save as preset… keeps a building's levels, flats, rooms, flat layouts, room types and riser lengths (no DB links, no riser board) in Library.json, with import / export; From preset / past project… adds buildings from a preset or another project with new ids, after a review (layouts reused or added, room types added, figures that differ kept or replaced); Flats / tenants → Save to library / From library… writes to and picks from UnitTypes.xlsx
- Design references (branch `design-references`): Standards → Design references. Built-in DEWA, IEC 60364, BS 7671, ADDC, EtihadWE (all "to verify"); your own references (duplicate, edit values with clause + note, free reference entries, import / export) saved in LV Database/Library.json; apply to a project with a before/after preview; the project records reference + version; the design report cites it as the source of each value
- Panels page (tabs): Quick create, Panel list, Naming, Typical floors, Repeat group, Templates
- Emergency: EMDB with ATS + generator, ESMDB / EDB below it
- Naming schedule: renumber incremental or by level, rename everywhere
- Enclosure sizing from supplier chart
- SLD speed: only draws what is in view (1,000 boards: 6.6 s → 0.43 s)
- Update script: `npm run update-app` (compares with installed version)

## In progress
- SLD UX redesign in 3 phases — [[SLD workspace UX - 2026-10-13]]
  - Phase 1 (branch `sld-workspace-ux`, v1.32): drawing fills the free height, inspector can be hidden / resized, inspector tabs wrap, zoom kept while editing, fail / check chips jump to the next circuit
  - Phase 2: board-wise SLD sheets with R / Y / B phase loading, auto-balance — not started
  - Phase 3: earthing screen (full-width drawing, pit schedule tab, settings drawer, board sheets link to earthing) — not started

## Next (not started)
- Emergency ATS arrangement details
- Earthing I²t check
- UPS leading kvar
- Enclosure chart – questions for supplier
- Unbalanced load flow
- Clickable links in PDF
- Drawing set in issue package
- Future ideas: [[Future development]]
