# Future development

Ideas and features agreed for later. One note per idea; link it here.

## On hold — explicit user confirmation required

- [[International authority profiles - review - 2026-10-04]] — retain the UAE/India configuration, calculation and submission-format research for future use. Develop for **Dubai / DEWA first**. International support must not start until the user confirms proceeding.
  - 2026-10-12: the user asked for **design references** (DEWA, IEC, BS 7671, ADDC, EtihadWE + user-defined) that fill project settings — built. ADDC / EtihadWE values are copied from DEWA and marked "to verify". Full authority packs (forms, SLD notes, checklists per authority) remain on hold.

## Planned
- [[Project management plan]] — project identity, creation wizard, safe saving and conflict detection, search/archive, setup templates, per-project recovery and backups (plan drafted 2026-10-05, awaiting decisions D1–D7)
- [[AI agent proposal]] — agent / local LLM tools to build a full design (G+10 ≈ $4–10 with Claude)
- [[BIM integration - 3D - 2026-10-21]] — Revit / IFC link for elevations, 3D tray and cable routes, spaces with volume; the CAD link stays **2D plan only** until then (noted 2026-10-21)
- [[Standard load details for regular use]] — a ready set of regular loads with references and watts (sockets SS1 200 W, TS1 400 W so far), picked into circuits and WATT / UNIT (noted 2026-10-16)
- Enclosure charts for SMDB, MDB, LV MDB, MCC — waiting for supplier data (DB chart done)
- ~~Transformers: one LV panel fed by two transformers with a coupler~~ — done: normally open or closed (transformers in parallel) — fault level, load sharing, coupler current and IEC 60076-8 conditions (v1.75); chosen by clicking the coupler on the SLD, N/C drawn (v1.76)
- ~~Earthing on the riser diagram (LV pits at the base, main earth conductor up the floors)~~ — done: earthing riser with a floor earth bar on every level, any number of floors over sheets or typical floors grouped (v1.47), floor earthing sheets, several risers per building (v1.48)
- ~~Panel SLD "EARTH PITS (2 NO.)" detail: keep or replace~~ — kept, now follows the earthing plan (v1.34)
- ~~Combining with an existing DEWA system (existing transformers / spare capacity)~~ — done (v1.74): extension / retrofit with recorded maximum demand, EXISTING on drawings, not in the BOQ, transformer / incomer / feeder / spare-way checks. A new building on an existing substation shared with other buildings: calculations done (v1.76) — other buildings' allocated / recorded load kept, RMU T-off check, a neighbour MDB's supply fault level; entering the other buildings in the app waits for approval: [[UI UX proposals - 2026-10-22]]
- ~~Emergency ATS arrangement details~~ — done (v1.73): ATS rating and type, or mains + generator incomers with electro-mechanical interlock and instruments per incomer; see [[Emergency rules]]
- Earthing I²t check — incomer CPC check shown per board (v1.34); pit / electrode conductors still need the HV earth-fault level from DEWA
- UPS leading kvar
- ~~Unbalanced load flow~~ — done (v1.75): per-phase sweep with the neutral — phase voltages and drop per phase, neutral current against the incomer rating, neutral shift, voltage unbalance (2 %); in the Phase balance study. Not included: triplen harmonics in the neutral
- Clickable links in PDF reports
- ~~Drawing set in the issue package~~ — done: the issue package includes the drawing register and every sheet of Documents → Drawings from the same calculation run (option in report setup, on by default)

## To confirm with supplier
- Enclosure chart: 600 × 500 shows 6 usable modules for > 12 ELCB

Up: [[LV Design Studio]] · Status: [[Status]]
