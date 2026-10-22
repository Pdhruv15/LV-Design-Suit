# UI / UX proposals — 2026-10-22

## Bus coupler: normally open or closed (transformers in parallel)

Approved and done 2026-10-22 (v1.76): clicking a coupler opens a form (operation: normally open / normally closed / remove; rating), the SLD draws a closed coupler with the closed breaker symbol and `N/C`, and N/C is in the drawing abbreviations. Uses the existing form dialog — no new styles. As proposed:

1. **Choosing the mode.** Clicking a coupler on the SLD now removes it (after a confirm). Proposal: the click opens a small coupler panel instead — rating (A), *Operation: Normally open (one transformer out → the other carries both) / Normally closed (transformers in parallel)*, and *Remove*. Same panel style as the board inspector.
2. **SLD symbol and label.** A closed coupler drawn with the closed breaker symbol (as the outage scenario already draws it) and labelled `N/C` instead of `N/O`; tooltip "normally closed — transformers in parallel". The outage scenario keeps `CLOSED · current (loading)`. Black-and-white PDF/DXF unchanged apart from the symbol and label.
3. **Supply scenario.** With a closed coupler, the "Transformer of … failed" choice stays (the other transformer carries both, as with a normally-open coupler).

Already done without UI changes: busbar fault level from all paralleled transformers (and everything below), transformer sizing fault check, load sharing by kVA ÷ uk %, coupler current, IEC 60076-8 conditions (vector group, uk within 10 %, ratings within 2 : 1) in the Transformer & generator study, fault-study method note, design basis and BOQ wording, OpenDSS and pandapower runs joining the busbars.

## Existing board: other buildings on a shared supply

The calculations support it (branch `feat/shared-substation`): `existing.others` on an existing board lists the other buildings it supplies (not drawn in the project), each with its allocated load, recorded load and a reference; the higher of allocated and recorded is kept for each. Nothing in the app sets it yet. Waiting for approval of:

1. **Board properties → Existing installation** (under *Spare ways at survey*): a small table *Other buildings on this supply* — Name · Allocated (kVA) · Recorded (kVA) · Reference (DEWA NOC / load letter), a remove (×) on each row and *+ Add building*. Same inputs and spacing as the fields above it. A line under it: "Kept for them: 950 kVA (the higher of allocated and recorded, each)".
2. **No drawing change**: the SLD keeps showing the recorded MD reading; the other buildings appear in the Transformer & generator study (*Existing installation and shared supply*) and the Existing installation card in Sizing.

Covered without UI changes: the new building on an outgoing way of the existing LV panel, a new transformer on the existing substation's RMU (check: spare T-off way, at most 2 transformers per RMU — the RMU is set in Transformers), and a feed from a neighbouring building's main board (its fault level, entered on the transformer summary form, now sets the fault instead of a placeholder).

## UPS: input filter and generator leading kvar

The calculations support it (v1.78): `inputFilterKvar` (the UPS input filter's leading kvar at light load, from the datasheet) and `genLeadingPct` (the leading kvar the standby generator absorbs, % of its kVA, from its reactive capability curve) on a UPS. Blank, they are 10 % of the UPS kVA and 10 % of the generator kVA. The result already shows in the UPS study notes and the dashboard. Approved and done 2026-10-22 (v1.78): both inputs are in the UPS study after *UPS output PF*. As proposed:

1. **UPS study → UPS inputs**, after *Output power factor*: *Input filter (kvar leading)* with placeholder "10 % of UPS kVA", and *Generator absorbs (% leading)* with placeholder "10". Same inputs as the fields beside them.
2. **No other change**: the check stays in the notes line and the dashboard to-do list.
