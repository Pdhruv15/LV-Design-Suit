# UI / UX proposals — 2026-10-22

## Bus coupler: normally open or closed (transformers in parallel)

Approved and done 2026-10-22 (v1.76): clicking a coupler opens a form (operation: normally open / normally closed / remove; rating), the SLD draws a closed coupler with the closed breaker symbol and `N/C`, and N/C is in the drawing abbreviations. Uses the existing form dialog — no new styles. As proposed:

1. **Choosing the mode.** Clicking a coupler on the SLD now removes it (after a confirm). Proposal: the click opens a small coupler panel instead — rating (A), *Operation: Normally open (one transformer out → the other carries both) / Normally closed (transformers in parallel)*, and *Remove*. Same panel style as the board inspector.
2. **SLD symbol and label.** A closed coupler drawn with the closed breaker symbol (as the outage scenario already draws it) and labelled `N/C` instead of `N/O`; tooltip "normally closed — transformers in parallel". The outage scenario keeps `CLOSED · current (loading)`. Black-and-white PDF/DXF unchanged apart from the symbol and label.
3. **Supply scenario.** With a closed coupler, the "Transformer of … failed" choice stays (the other transformer carries both, as with a normally-open coupler).

Already done without UI changes: busbar fault level from all paralleled transformers (and everything below), transformer sizing fault check, load sharing by kVA ÷ uk %, coupler current, IEC 60076-8 conditions (vector group, uk within 10 %, ratings within 2 : 1) in the Transformer & generator study, fault-study method note, design basis and BOQ wording, OpenDSS and pandapower runs joining the busbars.
