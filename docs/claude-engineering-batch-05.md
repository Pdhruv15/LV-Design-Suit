# Claude correction brief — Engineering Batch 5

Reviewed on 3 October 2026 against commit `b50da96`.

Correct only **ENG-009** and **ENG-010** below. Keep the two behaviors separately explained and verified, even if they share an implementation helper. Preserve earlier batches. Stop after these corrections for owner verification.

No application code was changed by this review. The findings were reproduced through `calcPfc` and report HTML generation executed in memory. Existing PFC tests passed **11 tests across two files**, and TypeScript checking passed. Browser interaction and rendered PDF layout were not checked. These passing tests do not cover the defects below.

## ENG-009 — Calculate achievable compensation from actual switched steps

**Priority: high.** Location: standalone Power factor correction calculator → bank, before/after results, diagrams and report.

The calculator selects a bank in whole steps but computes `q2 = q1 − min(bankKvar, q1)`. When the selected bank exceeds reactive demand, this assumes a continuously variable capacitor output. The configured contactors can only switch whole steps. The result can claim unity PF and savings that no permissible switching state produces.

Primary files:

- [pfcCalc.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/pfcCalc.ts): `calcPfc`, bank selection, `q2`, derived savings, step table, diagrams and comparison targets.
- [PfcCalculator.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/PfcCalculator.tsx:82): displayed after-PF and bank results, warnings and Add bank workflow.
- [pfcReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/pfcReport.ts:21): before/after table, headline, calculation method and bank selection.
- [pfcCalc.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/pfcCalc.test.ts): meaningful regression coverage.

Executed fixture: `PFC_CALC_DEFAULT`, mode `kw-pf`, **10 kW**, PF **0.8 lagging**, target **0.95**, step **25 kvar**, supply **400 V**. Other defaults unchanged.

| Quantity | Current output | Physically available states |
| --- | --- | --- |
| Initial Q | 7.5 kvar | 7.5 kvar |
| Installed bank | 25 kvar, one 25 kvar step | Off or 25 kvar; no intermediate output |
| Claimed Q after | 0 kvar | Off: **+7.5 kvar**; on: **−17.5 kvar** |
| Claimed PF after | 1.000 | Off: **0.800 lagging**; on: **0.496139 leading** |
| Claimed current after | 14.433757 A | Off: **18.042196 A**; on: **29.092167 A** |
| Claimed released capacity | 2.5 kVA | Off: **0 kVA** |
| Claimed copper-loss reduction | 36% | Off: **0%** |

The app's own step table already reports the on-state PF as `−0.496139` (negative here encodes leading). The headline and diagrams nevertheless use a fictitious 7.5 kvar compensation. The warning says automatic steps keep the bank from going leading without explaining that this fixture must leave its only step off and cannot achieve the target. Report HTML prints `Capacitor bank 25 kvar = 1 × 25 kvar ... PF 0.80 → 1.000`.

Independent arithmetic: `Q1 = 10 × tan(acos 0.8) = 7.5 kvar`; target need is approximately **4.213159 kvar**. `Qafter = Q1 − k × 25` for integer `k` in `{0,1}`. Apparent power is `hypot(P,Qafter)`; current is `S × 1000 / (√3 × 400)`.

Required correction:

1. Distinguish installed bank capacity from energized compensation and active step count. Compute the operating result from a realizable integer switching state, not a continuous clamp.
2. State the selection policy. For the existing no-leading policy, choose only states with nonnegative remaining Q and identify whether a state reaches the requested target. In this fixture, leave the step off, preserve the original electrical quantities, and report **target not achievable with this step size**.
3. A smaller step may be suggested, but do not silently change the owner's configured hardware. Keep the displayed configuration and achieved result consistent.
4. Use the same operating state for PF, Q, current, released kVA, copper-loss estimates, transformer loading, diagrams and report derivations. The report must not subtract the full installed bank while displaying another operating result.
5. Review comparison-target rows and Add bank messaging: installed capacity may be offered as a design option, but must not be represented as guaranteeing the displayed target with unsuitable steps.

Acceptance checks:

- Reproduce the fixture: no-leading operation uses zero active steps, PF 0.8, unchanged current and zero savings; target-unreachable warning appears in UI and report.
- Test a nonzero reachable state, e.g. **100 kW at PF 0.8**, target 0.95, steps 25 kvar: Q1 = 75 kvar; two active steps give Qafter = 25 kvar and PF **0.9701425**.
- Test exact Q/step equality (unity is achievable), a step larger than Q, and a target that cannot be achieved without leading even when a smaller nonzero step is available.
- Keep the existing 400 kW / PF 0.8 / target 0.95 / 25 kvar regression: 175 kvar energized, Qafter 125 kvar, PF approximately 0.954480.
- Assert that headline/diagram values correspond to a row in the feasible step table, rather than merely repeating the implementation formula.

Engineering basis: automatic banks change output in discrete contactor-controlled steps; attainable PF depends on step size. [Schneider Electric — equipment to improve power factor](https://www.electrical-installation.org/enwiki/Equipment_to_improve_power_factor).

## ENG-010 — Preserve leading reactive power when no correction is applied

**Priority: high.** Location: standalone PFC calculator → utility-bill input and before/after report.

Bill mode accepts signed reactive energy and `loadOf` preserves its sign. For negative Q, the same `min(bankKvar, q1)` expression removes the entire leading reactive power even when the selected bank is zero. The app claims improved PF and savings from no installed equipment. Its PF magnitude display also omits the leading direction.

Files: the same calculator/UI/report files above, especially `loadOf` bill handling, `calcPfc` zero-bank path, angle/phasor presentation and the before/after report.

Executed fixture: `PFC_CALC_DEFAULT`, mode `bill`, **72,000 kWh**, **−54,000 kvarh**, **720 operating hours**, supply **400 V**, target PF **0.95**. Other defaults unchanged.

| Quantity | Current result | Required no-correction result |
| --- | --- | --- |
| P / initial Q | 100 kW / −75 kvar | Unchanged |
| Selected bank | 0 kvar | 0 kvar; capacitors cannot correct this leading condition |
| Q after | 0 kvar | **−75 kvar** |
| PF before → after | 0.8 → 1.0 | **0.8 leading → 0.8 leading** |
| Apparent power after | 100 kVA | **125 kVA** |
| Current before → after | 180.421959 → 144.337567 A | **180.421959 → 180.421959 A** |
| Released capacity | 25 kVA | **0 kVA** |
| Copper-loss reduction | 36% | **0%** |

The report headline says `Capacitor bank not needed`, while its before/after calculation shows nonexistent improvement. The warning also says a zero-kvar bank exceeds a negative reactive demand and automatic steps prevent leading: this is misleading.

Independent arithmetic: `P = 72000/720 = 100 kW`, `Q = −54000/720 = −75 kvar`, `S = hypot(100,−75) = 125 kVA`. With zero applied correction, `Qafter = Qbefore`. Signed phase angle is `atan2(Q,P) = −36.869898°`.

Required correction:

1. Preserve signed Q when no compensation is applied. For supported signed inputs, capacitors subtract positive kvar and cannot cancel an already negative Q. Select no capacitor and explain the leading condition.
2. Keep PF magnitude and leading/lagging direction explicit and consistent in UI, step table, diagrams and report. Do not infer direction from `acos(PF)` alone; use signed Q for angles/phasors.
3. If signed reactive energy is outside the intended product scope, explicitly reject it with a validation message and suppress calculation/export success. Do not silently alter it, take its absolute value or claim corrected results. Supporting signed Q is preferred because the existing load helper already does so.
4. Explain that net monthly reactive energy is an average and may conceal varying leading/lagging operation. Do not size a real switched bank solely from that average as if it proved suitability at every load condition. This is a method disclosure, not a request for a new time-series engine.
5. Do not automatically add reactors or change existing capacitor banks in this batch. Such remedial design needs separate data and configuration.

Acceptance checks:

- Reproduce the fixture with zero correction, unchanged signed Q/current/PF and zero released capacity/loss savings; leading condition must be visible in the report.
- Verify zero-bank invariance for an ordinary already-good lagging PF input and unity PF as well.
- Verify a positive-reactive bill still uses the intended capacitor-sizing method and the discrete-step correction from ENG-009.
- Check signed-angle diagrams and report labels; no warning may claim that a zero bank removed leading Q.
- If choosing validation instead of support, test that rejected signed inputs cannot yield a successful calculation or misleading exported report.

Engineering basis: capacitor compensation supplies capacitive reactive power; it reduces positive inductive Q. This source supports that direction of compensation, not a universal bill-sign convention. The fixture explicitly treats negative kvarh as net capacitive energy. [Schneider Electric — theoretical principles to improve power factor](https://www.electrical-installation.org/enwiki/Theoretical_principles_to_improve_power_factor).

## Delivery requested from Claude

For each issue return changed files, corrected calculation basis, before/after fixture results and regression-test results. Explain which hardware state produces each claimed result. Preserve previous corrections and report additional discoveries separately. Do not declare the full PFC design, all app calculations or PDF layout verified by this batch.
