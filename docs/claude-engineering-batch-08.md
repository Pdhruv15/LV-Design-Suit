# Claude correction brief — Engineering Batch 8

Reviewed on 3 October 2026 against commit `77a445e`.

Correct only **ENG-015** and **ENG-016**. Preserve earlier batches, keep each change separately reviewable and stop after these issues for owner verification.

No application code was changed by this review. Fixtures were executed through the calculation functions in memory. Existing containment and quick-calculator tests passed **12 tests across two files**, and TypeScript checking passed. UI/report consumers were inspected in source; browser interaction and rendered PDF layout were not verified.

## ENG-015 — Require physical cable fit before recommending parallel containment

**Priority: high.** Location: standalone containment calculator → conduit/trunking and report.

When no conduit or trunking fits, the algorithm exhausts its run limit and falls back to the largest size. It then computes fill by dividing total cable area by the number of runs. This can label an impossible installation `ok`: an individual cable cannot be divided across multiple conduits or trunking runs.

Files:

- [containment.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/containment.ts): conduit/trunking candidate selection, fallback, result status and cross-section SVG.
- [ContainmentCalculator.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/docs/ContainmentCalculator.tsx): selected size, status and failure presentation.
- [containmentReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/containmentReport.ts): recommended size, fill, notes and drawing.
- [containment.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/containment.test.ts): meaningful regression coverage.

Executed fixtures: start from `CONTAINMENT_DEFAULT`, replace the cable list with one cable named `oversize`, four cores, 95 mm², quantity **1**, explicit OD as below. These are synthetic boundary inputs; the explicit diameter controls geometry and is not claimed to be a real 95 mm² product.

| Mode/input | Current recommendation | Current status | Physical constraint |
| --- | --- | --- | --- |
| Conduit, cable OD **70 mm** | **10 × Ø63 mm**, internal diameter **56.4 mm**, reported fill **15.404155%** | `ok` | 70 mm cable cannot pass through any 56.4 mm bore |
| Trunking, cable OD **300 mm** | **6 × 300 × 200 mm**, reported fill **19.634954%** | `ok` | 300 mm cable cannot fit inside a 200 mm-high run |

The conduit warning says `Too many cables for one 63 mm conduit: 10 conduits`, although there is only one cable. The low fill is a fictitious average: `π × 70² / 4` has been spread over ten conduits. The trunking fallback similarly bypasses the height constraint that its candidate search originally enforced.

Required correction:

1. Remove success fallbacks after candidate search fails. Represent unavailable geometry explicitly, with a failure/no-fit state and a reason. Extend the result status beyond `ok | warn` if necessary and update all consumers.
2. Check every indivisible cable against the usable dimensions of its assigned containment. Parallel runs can distribute multiple cables; they cannot make one oversized cable fit.
3. For a successful multi-run recommendation, construct a feasible assignment of whole cables and check each run's fill and dimensions. Total area divided equally by run count is only a lower-bound estimate and does not prove packability. If exact assignment is outside scope, label the result as an estimate requiring allocation verification instead of a verified fit.
4. Use the applicable fill rule for the actual cable count in each conduit, or explicitly use the user's fixed override. Do not apply the total route cable-count rule to every conduit without checking the allocation.
5. Reports and cross-section drawings must show no-fit or the real allocation, not a successful schematic for physically impossible containment. Preserve normal tray/ladder behavior and existing spare policy.

Acceptance checks:

- Reproduce both fixtures: no suitable size, no success status, and no claim that ten conduits split one cable.
- Verify a valid single-cable case retains a physically fitting bore and acceptable fill.
- Test multiple large cables where average area suggests a fit but one run would exceed the limit after whole-cable allocation.
- Test exactly fitting dimensions/fill and just-over-limit values, plus a user-entered fixed fill override.
- Test a true multi-run case and assert every cable is assigned once and every run meets its constraints.
- Verify UI/report no-fit parity and absence of fabricated successful cross-sections.

Engineering basis: conduit fill is cable occupied area relative to actual internal conduit area; manufacturer tools also distinguish cable OD and conduit internal diameter. The indivisible-cable constraint additionally follows basic geometry. This review does not validate the app's claimed IEC/NEC default percentages for every local installation. [Southwire — conduit fill calculator](https://www.southwire.com/calculator-conduit).

## ENG-016 — Reject inconsistent power-triangle input pairs

**Priority: medium.** Location: Quick calculators → kW ↔ kVA ↔ kVAr.

`triangle` clamps negative squared residuals to zero and returns finite results for impossible pairs. The UI accepts a result whenever `cT.kva` is finite, so its existing warning about compatible values does not appear for these cases.

Files:

- [quick.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/quick.ts): `triangle` input validation and derived quantities; review `powerFromCurrent` because it also calls this function.
- [QuickCalcs.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/QuickCalcs.tsx:184): result validation and warning text.
- [quick.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/quick.test.ts): valid and invalid input-pair regressions.

Executed cases:

| Input | Current returned result | Required behavior |
| --- | --- | --- |
| P **20 kW**, S **10 kVA** | Q **0 kvar**, PF **2** | Reject: apparent power cannot be below active-power magnitude |
| S **10 kVA**, Q **20 kvar** | P **0 kW**, PF **0**, Q retained as 20 | Reject: apparent power cannot be below reactive-power magnitude |
| P **80 kW**, S **100 kVA** | Q **60 kvar**, PF **0.8** | Preserve valid result |

The first result violates PF magnitude ≤1. The second violates `S² = P² + Q²`: 100 is not 400. Zero-clamping cannot repair inconsistent measured inputs.

Required correction:

1. Validate supported pairs before deriving values: finite inputs, physically valid apparent-power magnitude, compatible P/Q magnitudes and PF within the supported domain. Do not silently clamp an invalid entered PF into range.
2. Return an explicit invalid result/reason or the existing invalid-number convention consistently. Do not provide a partially finite success object that the UI treats as valid.
3. Use a small documented numerical tolerance for roundoff near equality. Do not use a tolerance large enough to accept materially inconsistent measurements.
4. Handle zero-power and PF-zero cases explicitly: distinguish a valid pure-reactive case from insufficient/contradictory information. If leading/signed Q is supported, retain direction consistently while keeping S nonnegative. Otherwise reject unsupported signed inputs clearly.
5. Make the UI check the complete validity state and show the reason. Its warning should cover `|Q| ≤ S` as well as `|P| ≤ S`. Preserve valid ordinary current-to-power calculations.

Acceptance checks:

- Reject both invalid fixtures above and show the validation warning instead of ordinary output cards.
- Preserve the valid 80/100 case and all five UI input-pair modes.
- Test boundary P = S (unity PF), |Q| = S (pure reactive), close floating-point equality and a clearly excessive value.
- Test entered PF above 1/below the supported range, nonfinite inputs and ambiguous zero inputs.
- For every valid result, independently assert the triangle identity and PF ratio within tolerance; do not just repeat the implementation's zero-clamp expression.
- Verify `powerFromCurrent` and other callers still behave consistently after any result-type change.

Engineering basis: apparent power magnitude, active/reactive power and PF obey the stated triangle relationships within the sinusoidal model used by this calculator. This correction does not add harmonic distortion-power modeling. [Schneider Electric — reactive and apparent power](https://www.electrical-installation.org/enwiki/Definition_of_reactive_power), [definition of power factor](https://www.electrical-installation.org/enwiki/Definition_of_Power_Factor).

## Delivery requested from Claude

Return changed files, corrected method, before/after fixture outputs and regression-test results for each issue. Keep UI/report status consistent with calculation validity. Preserve earlier corrections and list additional findings separately. Do not claim all containment engineering, all quick calculators or PDF layout validated by this batch.
