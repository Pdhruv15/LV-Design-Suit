**Claude correction brief — Engineering Batch 3**

Reviewed on 3 October 2026. Final test baseline: commit `187ac4c`.

Please correct only **ENG-005** and **ENG-006** below. Keep the changes separately reviewable, preserve the earlier batches, and stop after these two issues. The owner wants to verify small batches before continuing.

The findings were checked through calculation functions, report data/HTML, and the Solar Add/Update callbacks executed in memory. No application code was changed by this review. Browser interaction and rendered PDF layout were not checked.

**ENG-005 — Derive incomer current and voltage drop from downstream real and reactive power**

Priority: high. App locations: **Cable & breaker sizing**, **Load flow / voltage drop**, incomer properties, and associated reports.

The current incomer calculation sums downstream phase kW, then divides by the incomer's entered PF. It ignores the downstream loads' individual PFs and capacitor kvar. Board-summary current already uses combined real/reactive power, so a balanced board and its incomer can disagree. Changing only the incomer current would leave voltage-drop calculations and cable selection using the wrong PF.

Primary files and consumers:

- [electrical.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/electrical.ts:62): `designCurrentA`, `voltageDropPct`, candidate voltage-drop checks in `selectCable` / `selectCableRuns`.
- [loadSchedule.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/loadSchedule.ts:105): `boardPhaseKw`; introduce or reuse a phase real/reactive-power helper without silently changing this existing helper's other callers.
- [voltageDrop.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/voltageDrop.ts:62): `vdRow`, `vdFormula`, cable suggestions and upstream calculations.
- [sizing.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/sizing.ts:239) and [FeederForm.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/FeederForm.tsx:79): cable candidates currently receive the stored incomer PF.
- [VoltageDropStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/VoltageDropStudy.tsx:247), [annotations.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/diagram/annotations.ts:88), [voltageDropReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/voltageDropReport.ts:23), and [studyReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/studyReport.ts:207): PF/current/formula display and report parity.

Executed fixture: MDB → SMDB through a 60 m, 4-core, 95 mm² incomer at entered PF 1; supply 415 V, reference copper cable data, default conductor-temperature factor 1.2, one cable run. Downstream balanced loads are 100 kW × DF 0.8 at PF 0.8 and 40 kW × DF 1 at PF 1. Combined demand is **120 kW + j60 kvar**.

| Output | Current result | Required result |
| --- | --- | --- |
| Combined demand PF | Incomer uses entered PF 1 | 0.894427 |
| Incomer current | 166.944656 A | **186.649800 A** |
| Board-summary current | 186.649800 A | 186.649800 A |
| Incomer voltage drop | 0.968222% | **1.124993%** |
| Standalone VD row | 0.968222%, PF 1 | Same corrected calculation basis |
| Load-flow report incomer row | 166.9 A / 0.97% | Approximately **186.6 A / 1.12%** |

Reference arithmetic: `S = hypot(120, 60) = 134.164079 kVA`, `I = S × 1000 / (√3 × 415)`. Cable R at the default temperature is `0.193 × 1.2 = 0.2316 Ω/km`; X is `0.075 Ω/km`. The balanced drop is `L × (R × P + X × Q) × 100 / U²`, with L in metres, P in kW, Q in kvar, and U the line voltage.

Additional executed cases:

| Case at 415 V | Current incomer result | Required current |
| --- | --- | --- |
| R: 10 kW at PF 1; Y: 9 kW at PF 0.6; B: zero | 41.736164 A, governed by R kW | **62.604246 A**, governed by Y's 15 kVA |
| Balanced fixture plus 30 kvar capacitor | 166.944656 A | **172.082613 A**, net Q +30 kvar |
| Balanced fixture plus 90 kvar capacitor | 166.944656 A | **172.082613 A**, net Q −30 kvar |

The corresponding balanced voltage drops with 30 and 90 kvar capacitors should be **1.046608%** and **0.889836%**. Equal current magnitude does not mean equal voltage drop: retain the sign of Q.

Required correction:

1. Derive downstream **P and signed Q per phase** recursively. For each ordinary load, apply its demand factor once and derive Q from its own valid PF. Capacitors contribute negative kvar. Do not count an incomer's placeholder `loadKw` or demand factor as an additional load.
2. Allocate explicitly labelled single-phase circuits to their phase. Retain the current fallback for older unlabelled single-phase feeders and three-phase circuits, which spreads their power evenly. Document and preserve the existing treatment of generation and standby loads in this batch; do not accidentally switch to a net-generation model by substituting `boardTotals` wholesale.
3. For three-phase incomers, use `max(hypot(Pphase, Qphase)) × 1000 / U0`, where `U0 = U / √3`. An edit to the incomer's stored PF must not change the derived downstream current.
4. Use the same downstream power basis for the existing nominal voltage-drop approximation. For 3/4-core incomers, evaluate each phase's first-order conductor drop as `L × (R × Pphase + X × Qphase) / (U0 × runs)` volts, then divide by U0 for percentage. Select the largest phase drop independently of the largest phase current. This reproduces the existing balanced formula. Retain the direct single-phase phase-plus-neutral loop method.
5. Keep the approximation's limits clear: this phase-conductor calculation is not a neutral-displacement or full unbalanced load-flow solver. Preserve the scalar upstream-drop convention unless implementing a consistently phase-aware path; a sum of individual worst cable drops must not be labelled an exact phase-specific total.
6. Reuse that evaluator for actual and candidate cable sizes in Fix/Optimise, feeder suggestions, and standalone VD suggestions. Preserve ampacity, breaker margins, parallel-run handling, project conductor temperature and voltage-drop budgets. Do not reintroduce the earlier temperature-selection inconsistency.
7. Make the UI and report formula fields reproduce the corrected numbers. If different phases govern current and voltage drop, show the appropriate phase/current/PF basis for each. A maximum-current value multiplied by another phase's coefficient is not a valid displayed derivation. Show derived incomer PF as read-only or clearly distinguish it from a stored legacy value. Preserve external-engine annotation overrides.

Acceptance checks:

- Add the mixed-PF, phase-selection and both signed-capacitor cases above, including nested downstream boards and PF-edit invariance.
- Add a case where current and VD have different governing phases: R = 10 kW at PF 1, Y = 6 kW at PF 0.5, B = zero. With the same 95 mm² reference cable, Y governs current and R governs the nominal phase-conductor drop.
- Assert parity between evaluated feeder results, `vdRow`, candidate selection and exported report numbers/formula inputs.
- Test Fix/Optimise by recomputing the applied cable against the same derived power basis and applicable budget.
- Keep end-load, capacitor-branch and homogeneous-PF behavior covered. Board-summary current is balanced demand current; equality with incomer current is required for the balanced fixture, not for unbalanced boards.

The power/current basis follows Schneider Electric's relations between P, Q, S and current; the phase-conductor extension above is an explicit approximation for this app. [Reactive power and apparent power](https://www.electrical-installation.org/enwiki/Definition_of_reactive_power), [steady-load voltage-drop formulae](https://www.electrical-installation.org/enwiki/Calculation_of_voltage_drop_in_steady_load_conditions).

**ENG-006 — Solar Add/Update must preserve the selected inverter phase count**

Priority: high. App location: **Solar PV → Inverter → Phases → Add / Update on the SLD**.

The Solar calculator correctly computes single-phase AC current, but the Add handler creates a four-core feeder. Update preserves the existing core count even when inverter phases change. The electrical engine then calculates current and sizes protection using the wrong phase system.

Primary file: [SolarStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/SolarStudy.tsx:35), `addToSld` and its base/updated feeder construction.

Executed fixture: PV defaults except target 5.5 kWp and inverter 5 kW, one phase; supply 400 V line-to-line, ambient 30°C, 30 m connection, VD limit 4%, reference cables, default conductor-temperature factor, no upstream cable. The result is 10 panels / 5.5 kWp and one 5 kW inverter. Feeder PF and DF are 1.

| Output | Current Add result | Required result |
| --- | --- | --- |
| Solar AC current | 21.650635 A | 21.650635 A |
| Generated feeder cores | 4 | **2** |
| Generated feeder current | 7.216878 A | **21.650635 A** |
| Recommended feeder breaker | 10 A | **32 A** |
| Recommended feeder cable | 1.5 mm² | **4 mm²** under this fixture |

Independent current: `5000 / (400 / √3) = 21.650635 A`. The current generated feeder is exactly one-third of that value. Under the same reference assumptions, the correctly modelled 4 mm² single-phase connection drops **3.11175%**, inside the 3.4% recommendation budget.

Both update directions were also reproduced: changing an existing four-core feeder to a one-phase inverter leaves four cores; changing an existing two-core feeder to a three-phase inverter leaves two cores.

Required correction:

1. Synchronize electrical phase count **before** calling `recommend`: two cores for a one-phase inverter, four cores for a three-phase inverter. Apply this on both creation and update of the same PV feeder ID.
2. Preserve `generation: true`, PV load type, PF/DF policy, connection board, and unrelated user-entered feeder properties. Recalculate breaker/cable recommendations after a phase change. Reconcile any stale explicit R/Y/B phase when changing to three-phase.
3. Do not invent a physical phase allocation. For a one-phase connection, either expose/preserve an explicit R/Y/B selection or clearly identify the existing unspecified-phase assumption. Multiple one-phase inverters are aggregated by the current calculator; do not silently reinterpret that as balanced three-phase generation.
4. Correct the connection-voltage label on the Solar page and PV report. In this fixture, show approximately **231 V phase-to-neutral** for the one-phase connection. The project supply remains 400 V line-to-line. A three-phase connection should retain the 400 V line-to-line label.
5. Preserve the current breaker-policy distinction: Solar AC sizing uses `I × 1.25`, while general recommendation uses `I / 0.85`. Both happen to give 32 A in this fixture. Other policy differences are outside this phase-propagation correction and should be reported separately if encountered.

Related files:

- [solar.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/solar.ts:181): correct phase-aware AC-current reference; preserve it.
- [SolarStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/SolarStudy.tsx:137): AC connection voltage label.
- [upsSolarReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/upsSolarReport.ts:70): PV PDF-source HTML labels the single-phase current with the line voltage today.
- [electrical.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/electrical.ts:71), [schedules.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/schedules.ts:77), and [exportDss.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/engines/opendss/exportDss.ts:107): verify downstream current, cable descriptions and phase count; avoid a separate engine-export redesign.

Acceptance checks:

- Cover actual Add/Update behavior, not only a manually constructed two-core fixture. Extract a small shared pure helper if necessary to test the behavior used by the component.
- New one-phase creation gives the fixture's correct current, cores, breaker and cable. Solar current and evaluated feeder current agree at PF/DF 1.
- Updates 3→1 and 1→3 change cores and recommendation without creating duplicate PV IDs; preserve unrelated properties and reconcile stale phase labels.
- New three-phase creation still gives **7.216878 A** for 5 kW at 400 V.
- Cover more than one single-phase inverter under the current aggregate-current assumption and make that assumption visible.
- Assert phase-to-neutral voltage labels in PV report HTML and correct phase count/current in the feeder study or schedule output. Check one rendered export if available.

The single-phase and balanced three-phase current relationships use different voltage bases. [Schneider Electric — apparent power and current](https://www.electrical-installation.org/enwiki/Installed_apparent_power_(kVA)).

**Verification and delivery**

Final baseline run: **103 tests passed in 9 suites**; TypeScript check passed. Existing tests do not cover these two end-to-end inconsistencies.

```sh
npm test -- src/calc/electrical.test.ts src/calc/loadSchedule.test.ts src/calc/summary.test.ts src/calc/voltageDrop.test.ts src/calc/upsSolar.test.ts src/calc/sizing.test.ts src/calc/parallel.test.ts src/docs/studyReport.test.ts src/docs/reportIntegrity.test.ts
npm run typecheck
```

Run any new regression files as well, plus the existing annotation/export tests when changing those consumers. Verify the current/PF/VD labels and Solar Add/Update results in the app, and compare the corresponding report outputs.

Return **ENG-005** and **ENG-006** separately: changed files, reason for each change, before/after fixture values, tests run, and any unresolved limitation. Stop after Batch 3 so the owner can verify it before the next corrections.
