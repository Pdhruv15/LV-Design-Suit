# Claude correction brief — Engineering Batch 6

Reviewed on 3 October 2026 against commit `2904724`.

Correct only **ENG-011** and **ENG-012**. Preserve previous batches and keep each correction separately explained and reviewable. Stop after these two issues for owner verification.

This audit changed no application code. Calculation fixtures were executed in memory. Existing busbar and earthing tests passed **13 tests across two files**, and TypeScript checking passed. UI and report consumers were inspected in source; browser interaction and rendered PDF layout were not verified.

## ENG-011 — Use downstream P and Q for each busbar voltage-drop segment

**Priority: high.** Location: Busbar risers, Voltage drop study and associated reports.

`sizeRiser` sums the magnitudes of individual floor kVA for vertical sections, then applies a single whole-riser PF. `riserVd` uses combined demand current for the first vertical section but uses the same whole-riser PF for subsequent sections. Floors with different PFs therefore produce inconsistent results, and neither implementation gives the correct section-by-section result under the app's existing balanced, first-order model.

Files:

- [busbar.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/busbar.ts): `sizeRiser` voltage-drop loop and `riserVd` segment calculations.
- [BusbarStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/BusbarStudy.tsx:186): top-drop display and material comparison.
- [VoltageDropStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/VoltageDropStudy.tsx:327): segment breakdown.
- [studyReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/studyReport.ts:278) and [voltageDropReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/voltageDropReport.ts:66): two report consumers.
- [busbar.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/busbar.test.ts): regression coverage.

Executed fixture: supply **400 V**, ambient **40°C**, copper busbar, diversity explicitly **1**, horizontal feed **10 m**, floor height **20 m**, offset **1**. No source board is selected, so upstream drop is zero. Lower floor A: **100 kW at PF 1**, at height 20 m. Upper floor B: **100 kW at PF 0.6 lagging**, at height 40 m. Start from `newRiser('T')` and replace those fields/floors.

Selected typical busbar: **630 A**, R **0.110 mΩ/m**, X **0.030 mΩ/m**. Overall demand is 200 kW + j133.333333 kvar, PF **0.832050294**, design current **346.944333 A**.

| Quantity | `sizeRiser` | `riserVd` | Required balanced first-order result |
| --- | --- | --- | --- |
| Top drop, riser/feed only | 0.748402082% | 0.712846955% | **0.675000000%** |
| Horizontal feed, 10 m | — | 0.162500000% | **0.162500000%** |
| Foot → A, 20 m | — | 0.325000000% | **0.325000000%** |
| A → B, 20 m | — | 0.225346955% | **0.187500000%** |

Independent arithmetic for each section:

`dropPct = 100 × 1000 × Lm × (RΩ/m × PkW + XΩ/m × Qkvar) / ULL²`.

The first 30 m carries P = 200, Q = 133.333333. The final 20 m carries only P = 100, Q = 133.333333, so its PF is **0.6**, not the overall PF. Sum the three segment drops to obtain 0.675%.

Required correction:

1. Carry downstream real and reactive power through each physical segment, including repeated floors. Apply the configured diversity consistently once. Sum P and Q before obtaining apparent power/current; do not sum individual kVA magnitudes as though their phase angles were identical.
2. Calculate section drop from its own P/Q basis. Reuse one evaluator for sizing-page totals, floor rows, material alternatives, detailed segments and reports.
3. Preserve signed Q from board-linked loads: the current `Math.max(0, t.demandKvar)` discards leading reactive power. Within this declared first-order model, signed Q affects both apparent current magnitude and the reactive drop term. Avoid using `acos(PF)` to reconstruct a positive Q when the actual Q is negative.
4. Keep existing upstream-drop conventions and clearly distinguish riser-only from total source-to-tap-off drop. The uniform-load result is an approximation; do not force it to equal the discrete calculation for unequal floors.
5. Preserve ambient derating, feeding-breaker sizing, fault-withstand checks and no-type handling. Do not turn this correction into a full unbalanced load-flow solver or a redesign of diversity policy.

Acceptance checks:

- Reproduce the fixture above and assert both totals and each detailed segment against the independent P/Q arithmetic.
- Verify common-PF floors retain their existing expected behavior.
- Reverse the two floors: the overall design current remains unchanged, but the top drop changes because the final section carries a different load.
- Verify repeated-floor counts and explicit diversity scale segment P/Q consistently.
- Add board-linked leading-Q and mixed leading/lagging cases; preserve direction and avoid fictitious unity PF.
- Assert page/report parity, with zero and nonzero upstream drop and both materials.

Engineering basis: the steady-load expression uses `R cosφ + X sinφ` for the current actually passing through the section. The P/Q form above is its balanced first-order equivalent. [Schneider Electric — steady-load voltage-drop calculation](https://www.electrical-installation.org/enwiki/Calculation_of_voltage_drop_in_steady_load_conditions).

## ENG-012 — Make parallel CPC thermal checks consistent with the modeled fault path

**Priority: medium.** Location: Earthing study → adiabatic minimum protective-conductor size.

`cableLoop` divides phase-plus-CPC loop impedance by the number of parallel runs, explicitly assuming each run has a parallel protective conductor. `evaluateEarthing` then uses the total resulting fault current in `S = I × √t / k`, comparing that aggregate requirement with one run's `cpcMm2`. This mixes total current and individual conductor area and can falsely fail the modeled equal-sharing end fault.

This finding does **not** establish that all possible faults share equally. A fault within one run can have a different return path. The correction must describe its topology and keep unsupported fault cases unverified rather than declaring blanket compliance.

Files:

- [earthing.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/earthing.ts): `cableLoop`, `evaluateEarthing`, result fields and adiabatic comparison.
- [EarthingStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/EarthingStudy.tsx:49): per-conductor result and assumptions.
- [report.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/report.ts:102) and [studyReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/studyReport.ts:253): thermal-check result and method disclosure.
- [earthing.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/earthing.test.ts): parallel-path regression coverage.

Executed fixture: supply **400 V**, source board MDB with **1,000 kVA / 5% impedance**, default transformer X/R and default operating-resistance factor. Feeder F: **15 m**, **two identical parallel runs**, phase conductor **4 mm²**, explicit CPC **4 mm² per run**, four cores, **32 A** breaker with default type C, no RCD. Load 10 kW, PF/DF 1; other project fields may use the sample project. Only MDB and F are needed.

For the existing modeled common-end fault:

| Quantity | Current output | Consistent equal-sharing interpretation |
| --- | --- | --- |
| Total fault current | 2,581.791200 A | Same total |
| Current in each identical CPC | Not distinguished | **1,290.895600 A** |
| Assumed duration / k | 0.1 s / 143 | Unchanged for this comparison |
| Minimum area shown against each 4 mm² CPC | 5.709329 mm² | **2.854665 mm² per CPC** |
| Adiabatic result for modeled end fault | `bad` | Passes this equal-sharing thermal comparison |

Independent arithmetic: `Smin,each = (Ifault / 2) × √0.1 / 143`. Equivalently, compare aggregate required area 5.709329 mm² with the aggregate **8 mm²**, only under the stated identical-sharing assumption. Keep total fault current for the breaker disconnection check.

Required correction:

1. Separate total fault current, current through the conductor being checked and per-run/aggregate CPC area. Make labels unambiguous.
2. For the already modeled identical parallel common-end path, evaluate each CPC using its share of total current, or perform an explicitly aggregate equivalent check. Keep single-run behavior unchanged.
3. State the required conditions: identical conductors/lengths, effective common-end bonding and the modeled fault location. Do not assume `parallel: 2` proves equal sharing for arbitrary faults, unequal cables, a common separate CPC or a single-run internal fault.
4. If the data model cannot establish the path, return an assumption-dependent/unverified thermal result or ask for explicit topology data. Do not silently mark every parallel circuit compliant. A bounded fix may retain the existing topology but expose its assumptions and limits.
5. Preserve disconnection current and thresholds. Keep the existing 0.1 s/k assumptions visible; this batch does not validate actual protective-device let-through energy, maximum fault heating or every fault location. Final thermal verification needs the applicable fault case and protective-device clearing/energy data.

Acceptance checks:

- Reproduce the equal-sharing fixture and assert per-run and aggregate arithmetic, labels and report parity.
- Keep a one-run regression unchanged.
- Test another identical-run count and verify that aggregate current is used for disconnection while the individual CPC thermal check uses the declared share.
- Ensure a genuinely undersized CPC still fails; do not divide current twice.
- Cover unsupported/unequal or internal-fault topology through an explicit unverified state or a separate valid calculation, not unconditional equal division.

Engineering basis: the adiabatic equation concerns current/energy through the conductor whose area is checked. The sharing assumption here follows the app's existing impedance model; it is not a universal rule for fault locations in parallel cables. [Schneider Electric — cable short-circuit withstand verification](https://www.electrical-installation.org/enwiki/Verification_of_the_withstand_capabilities_of_cables_under_short-circuit_conditions).

## Delivery requested from Claude

For each correction provide changed files, calculation basis, before/after fixture results, meaningful regression checks and remaining assumptions. Keep calculation, UI and report consistent. Flag further issues separately without expanding this batch. Do not declare full busbar or earthing compliance from these checks.
