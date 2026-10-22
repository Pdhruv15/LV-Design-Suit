# Emergency rules (DEWA practice)

- Normally **one EMDB** per building.
- EMDB has **dual supply**: mains (from MDB) + standby generator, switched by an **ATS**.
- Below EMDB: ESMDB and EDB only.
- Changeover, agreed 2026-10-22 (v1.73):
  - **ATS**: 4P, switched neutral; rating = the EMDB rating unless set; open transition and AC-33B (IEC 60947-6-1) by default.
  - **Mains + generator breakers, electro-mechanically interlocked** (DEWA drawing style): two incomers into the busbar, one closed at a time. Breaker 4P, ACB draw-out (DOT) from 630 A, MCCB below; generator breaker from its full-load current.
  - Each incomer carries: 3 ammeters on CTs, R-Y-B lamps, OC / SC / EF trip functions, PMU to BMS, voltmeter + selector switch, SPD — counted per incomer in the BOQ.

Related: [[Naming rules]]
