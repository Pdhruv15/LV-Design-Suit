# Status

_Last updated: 2026-10-20_

## Current development focus

- **Dubai / DEWA first** — engineering calculations, load schedules, SLDs and submission quality.
- International / India / additional-authority support is **on hold until explicit user confirmation**. Research is saved in [[International authority profiles - review - 2026-10-04]] under [[Future development]]; do not begin implementing that proposal now.

## Done (on main)
- Licence (v1.55): PolyForm Shield replaced by MIT OR Apache-2.0 (LICENSE-MIT, LICENSE-APACHE); anyone may use, change, redistribute and sell it, including closed-source. NOTICE keeps the name / logo note and third-party credits.
- README screenshots retaken on v1.54 (new ribbon, 10-overview-design-stages added); Overview stage buttons spaced.
- Stage tweaks (v1.53): Overview → "Back to <previous stage>" / "Reopen IFC" undoes a stage issued by mistake (the revision stays); 3 Detailed design tab fits 1,440 px — one "Add load ▾" button (load, motor, solar PV, EV, feeder cable), Run only (Undo / Redo on ⌘Z and the other tabs), "Enclosure".
- Design stages (v1.52, branch `design-stages`): Concept → Schematic → Detailed design → (Tender) → IFC. Ribbon tabs in stage order (Project · 1 Concept · 2 Schematic · 3 Detailed design · Documents · 4 Tender and IFC · BOM / Cost · Standards); a project opens on its stage's tab. Stage gate ("Issue concept → Schematic" …) records a revision, makes it the baseline and sets the drawing status (FOR CONCEPT REVIEW, FOR SCHEMATIC REVIEW, FOR AUTHORITY SUBMISSION, FOR TENDER, FOR CONSTRUCTION). Overview shows each stage's checklist; findings of a later stage are listed but not counted. Tender route: IFC used for tender (default) or tender before IFC; tender queries are Review comments of type Tender query. Older projects carry on as detailed design. 1 Concept → Concept report: one A4 black-and-white PDF (building, area schedule, maximum demand, supply, DM-D-013 room areas, items to confirm).
- Building reuse (branch `building-presets`): Building → Save as preset… keeps a building's levels, flats, rooms, flat layouts, room types and riser lengths (no DB links, no riser board) in Library.json, with import / export; From preset / past project… adds buildings from a preset or another project with new ids, after a review (layouts reused or added, room types added, figures that differ kept or replaced); Flats / tenants → Save to library / From library… writes to and picks from UnitTypes.xlsx
- Design references (branch `design-references`): Standards → Design references. Built-in DEWA, IEC 60364, BS 7671, ADDC, EtihadWE (all "to verify"); your own references (duplicate, edit values with clause + note, free reference entries, import / export) saved in LV Database/Library.json; apply to a project with a before/after preview; the project records reference + version; the design report cites it as the source of each value
- Panels page (tabs): Quick create, Panel list, Naming, Typical floors, Repeat group, Templates
- Emergency: EMDB with ATS + generator, ESMDB / EDB below it
- Naming schedule: renumber incremental or by level, rename everywhere
- Enclosure sizing from supplier chart
- MDB / SMDB Form-4 enclosure sizing from the owner's worksheet (v1.44)
- SLD speed: only draws what is in view (1,000 boards: 6.6 s → 0.43 s)
- Update script: `npm run update-app` (compares with installed version)

## In progress
- SLD UX redesign in 3 phases — [[SLD workspace UX - 2026-10-13]]
  - Phase 1 (v1.32, merged): drawing fills the free height, inspector can be hidden / resized, inspector tabs wrap, zoom kept while editing, fail / check chips jump to the next circuit
  - Phase 2 (v1.33, merged): Design ▸ Board view with ◀ ▶ supply-order navigation, R / Y / B loading strip (kW, A, neutral, unbalance vs 10 %), clickable phase tags, Balance phases for any board, circuit table with R / Y / B kW; board sheets (A3, black and white, one per board, E-SLD-01…) as PDF and DXF
  - Phase 3 (branch `earthing-screen`, v1.34): earthing drawing full width with zoom, pits shown pass / over limit / not tested, click a pit to record measured Ω, date and tester; Pits and tests and Checks tabs; settings drawer; E-EARTH-01 sheet (A3, black and white, PDF + DXF); live earth line + incomer CPC I²t on board view and board sheets; SLD earth pit detail follows the earthing plan

## Next (not started)
- Emergency ATS arrangement details
- Earthing I²t check
- UPS leading kvar
- Enclosure chart – questions for supplier
- Unbalanced load flow
- Clickable links in PDF
- Drawing set in issue package
- Future ideas: [[Future development]]
