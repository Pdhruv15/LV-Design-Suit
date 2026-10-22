# Standard load details for regular use

_Noted 2026-10-16. Built 2026-10-21 (branch `standard-load-library`) — decisions below._

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

## Decided and built (2026-10-21)

- **Where:** added to **Loads.xlsx** — Database → Loads.xlsx → *Add standard loads…* writes the missing items after your rows (backup first; your rows and any item with the same reference or name are never changed).
- **Values:** typical **draft** values for review (the user chose this over entering every figure). Each is editable in the dialog before adding, and each row is written with Notes = "Standard set — typical value, verify". SS1 200 W and TS1 400 W are the user's own figures.
- **Set (21 items):** L1 LED downlight 12 W · L2 LED panel 600×600 36 W · L3 LED batten 1200 mm 18 W · L4 LED wall light 10 W · L5 external / garden light 20 W · EM1 emergency / exit light 5 W · CF1 ceiling fan 75 W · EF1 exhaust fan 40 W · SS1 13A S/O 200 W · TS1 13A twin S/O 400 W · SS15 15A S/O 1000 W · SH1 shaver S/O 20 W · FS1 fused spur 500 W · WH1 water heater 3000 W · CK1 cooker 6000 W · HD1 hand dryer 1800 W · AC1 split A/C 1.5 TR 1900 W · AC2 split A/C 2.0 TR 2500 W · WAC1 window A/C 1.5 TR 2200 W · FCU1 fan coil unit 200 W · WP1 water pump 1 HP 1000 W.
- Projects follow the library as before. A company-wide template file is not built (Loads.xlsx in a shared folder already does that).
