# Enclosure sizing
Supplier chart → panel size; blank cells = not offered; overlaps need confirming.
Code: `calc/enclosure.ts`, `model/enclosureLibrary.ts`

MDB / SMDB (Form-4 tab, v1.44): line-up width from the owner's worksheet "LV PANEL SIZE SELECTION.xlsx" (FORM-4 Design Work Sheet). Breakers counted from the SLD, or entered by hand; H2100 + 100 plinth and D800 fixed. Points to confirm with the panel builder: fixed height/depth at every rating, the −300 chamber when there is no riser and more than one stacked section, no shipping split.
Code: `calc/form4.ts`, `model/form4Count.ts`, `components/Form4Sizing.tsx`. Mockup: `docs/form4-enclosure/mockup.html`

Part of: [[Panels]] · Data: [[Library]]

Issues and proposed solutions: [[DB enclosure issues and solutions]]
Test evidence: [[DB enclosure verification - 2026-10-04]]
