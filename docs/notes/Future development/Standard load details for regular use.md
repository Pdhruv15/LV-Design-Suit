# Standard load details for regular use

_Noted 2026-10-16, for later. Scope to be confirmed before work starts._

Up: [[Future development]] · Related: [[Status]]

## Idea

A ready set of load details for the loads used regularly on jobs (sockets, lights, fans, water heaters, A/C units, pumps…), so a new database or project does not start from an empty `Loads.xlsx`. Each detail would carry its reference (L1, SS1, TS1, EF1, WH1…), name, schedule column, watts and, where useful, power factor, phases and demand factor, and could be picked straight into a circuit's load items or a DB's WATT / UNIT row.

## Where it starts from

- v1.44 added the `Reference` column to `Loads.xlsx` and mixed-wattage load items per circuit (6 × L1 10 W + 4 × L2 20 W on one circuit).
- First regular items entered by the user (2026-10-16): **SS1** 13A single socket-outlet, **200 W**; **TS1** 13A twin socket-outlet, **400 W**.

## To decide

- Which loads go in the regular set, and their values — the user's figures only; the app assumes no wattage.
- Where the set lives: seeded into new `Loads.xlsx` files, a separate "regular loads" list, or a per-company template.
- Whether projects keep their own copy, or always follow the library.
