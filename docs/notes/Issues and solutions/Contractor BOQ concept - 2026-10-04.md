---
created: 2026-10-04
status: concept-only
tags: [boq, visual-concept]
---

# Contractor BOQ concept - 2026-10-04

Review: [[BOQ contractor scope issues and solutions]]
Evidence: [[BOQ verification - 2026-10-04]]

One BOQ engine with fit-out and new-installation templates. The visual is a proposal, not an implemented screen.

Current design-derived quantities form the starting point. Measured layouts, schedules, site conditions, work actions and supply/installation responsibility complete the contractor scope.

Manual extras and installation pricing already exist; the proposal adds structured scope selection and completion review.


## Visual concept

![[boq-contractor-scope-concept-2026-10-04.png]]

Generated using the built-in image-generation tool. This is a scope concept, not an implemented application screen.

## Generation prompt

```text
Use case: ui-mockup.
Create ONE high-resolution wide landscape visual concept, approximately 2000 pixels wide, for a desktop electrical-design application named LV Design Studio. It must explain the contractor BOQ enhancement at a glance with icons plus short text, not long paragraphs. Polished readable interface on a deep navy background, slate cards, pale text, blue and teal accents, amber for missing information. Use large crisp legible type with generous spacing. No prices, no invented quantities, no manufacturer logos. This is a concept, not a screenshot of implemented functionality.
Main title, exact: "Contractor BOQ — scope builder"
Subtitle, exact: "CONCEPT • Fit-out and new installation"
Top row: a compact mode selector showing two equal choices "Fit-out / alteration" and "New installation".
Upper content arranged as three well-spaced columns with large clear icons:
Left column title: "Current app"
Four compact icon rows: "Panels & protection", "Cables & accessories", "Trays, busway & earthing", "Selected power equipment".
Small teal footer inside this column: "Manual extras & labour pricing already available".
Middle column title: "Fit-out scope"
Five icon rows: "Survey existing installation", "Retain • Relocate • Remove", "DB alterations & final connections", "Shutdowns & temporary power", "Making good & handover".
Right column title: "New installation scope"
Five icon rows: "Main intake & distribution", "Feeders, risers & external routes", "Earthing & site works", "Generator / UPS / PV if included", "Full commissioning & handover".
Below all three, a prominent full-width amber-edged section titled "Complete the scope".
Five equal icon tiles labeled: "Lighting & emergency", "Sockets & switches", "Conduit, boxes & fittings", "Motor starters & controls", "ELV / fire alarm if included".
Below that a compact chip row titled "Each item needs" and chips "Quantity source", "Work action", "Supply responsibility", "Install responsibility".
Bottom full-width workflow with icons and arrows: "Model + layouts + site survey" → "Scope review" → "Supply + installation" → "Contractor BOQ".
A short amber footer at the very bottom, exact: "Fix quantity gaps first: grouped ELCBs • schedule points • wire units".
Ensure all text is readable and spelled correctly. Hierarchical clarity: current capability, additional contract scope, then workflow. Do not imply every project needs every optional system. Do not depict the fit-out/new-installation template as already implemented. Use concise exact labels above and no other explanatory paragraphs.
```
