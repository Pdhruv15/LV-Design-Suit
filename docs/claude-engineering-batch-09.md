# Claude correction brief — Engineering Batch 9

Reviewed on 3 October 2026 against commit `91727ef`.

Correct only **ENG-017** and **ENG-018**. Preserve earlier batches and keep each correction separately reviewable. Stop after these issues for owner verification.

No application code was changed by this audit. Fixtures were executed in memory through the calculation functions. Existing quick-calculator and UPS/PV tests passed **16 tests across two files**, and TypeScript checking passed. UI/report consumers were inspected in source; browser interaction and rendered PDF layout were not verified.

## ENG-017 — Preserve actual results when quick PFC selects zero correction

**Priority: medium.** Location: Quick calculators → power factor correction.

The quick `pfCorrection` function clamps required capacitor kvar to zero when the current PF already exceeds the target, but calculates its after-kVA from the lower requested target anyway. It therefore claims a change in apparent power without applying any correction. This is a separate quick-calculator path from the standalone PFC changes in Batch 5.

Files:

- [quick.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/quick.ts): `pfCorrection`.
- [QuickCalcs.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/QuickCalcs.tsx:241): capacitor and before/after result cards, input validation and no-correction explanation.
- [quick.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/quick.test.ts): regressions.

Executed fixture: **100 kW**, current PF **0.98**, target PF **0.95**.

| Quantity | Current output | Required no-correction result |
| --- | --- | --- |
| Capacitor requirement | 0 kvar | 0 kvar |
| Apparent power before | 102.040816 kVA | Unchanged |
| Apparent power after | 105.263158 kVA | **102.040816 kVA** |
| Reported kVA reduction | −3.157895% | **0%** |

Independent arithmetic: with zero applied capacitor output, Q and S remain unchanged. `Sbefore = 100 / 0.98`; `Safter = Sbefore`; reduction is zero. The requested lower PF is not an achieved post-correction operating point.

Required correction:

1. Distinguish requested target from achieved PF. If current PF is already at or above the target under this lagging-PF model, return zero correction and unchanged before/after electrical quantities.
2. Explain that no capacitor is needed to reach the target. Do not label negative apparent-power reduction as an outcome of a zero bank.
3. Validate finite nonnegative power and PF values within the supported domain. The UI currently checks PF > 0 but does not reject values above 1. Avoid clamping the kvar calculation while computing kVA from the original invalid PF.
4. Preserve valid improvement arithmetic for current PF below target. Keep this ideal continuous-kvar quick tool distinct from the standalone calculator's discrete hardware selection.

Acceptance checks:

- Reproduce the fixture and assert zero correction, unchanged kVA and zero reduction.
- Test equal current/target PF and current PF 1 with a lower target.
- Preserve a valid improvement: **100 kW, PF 0.8 → 0.95**, requirement approximately **42.131589 kvar**, Sbefore **125 kVA**, Safter **105.263158 kVA**, reduction **15.789474%**.
- Test zero power, invalid/out-of-range PF and nonfinite inputs with an explicit invalid/no-calculation display.
- Verify result-card labels distinguish no correction from a successfully improved operating point.

Engineering basis: capacitor compensation changes reactive power; zero compensation cannot change apparent power at fixed P. [Schneider Electric — theoretical principles of power factor improvement](https://www.electrical-installation.org/enwiki/Theoretical_principles_to_improve_power_factor).

## ENG-018 — Reconcile series battery voltage with the requested UPS DC bus

**Priority: high.** Location: UPS study → battery chemistry, module voltage and DC bus; UPS report.

`sizeUps` rounds `dcVoltage / blockV` to an integer series count. When the resulting physical string voltage differs from the request, it adds a note but continues using the requested voltage for capacity, nominal energy, end-of-discharge current and runtime. The reported selected hardware and calculation basis consequently describe different battery strings.

Files:

- [ups.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/ups.ts): series count, nominal voltage, required Ah, energy, end voltage/current, runtime and mismatch handling.
- [UpsStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/UpsStudy.tsx:90): chemistry switch retains the existing DC bus but changes module voltage; battery/DC displays.
- [upsSolarReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/upsSolarReport.ts:43): DC-bus equality and selected-battery results.
- [upsSolar.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/upsSolar.test.ts): series-voltage consistency checks.

Executed fixture: `UPS_DEFAULTS`, ID/name T, one **10,000 W** load at PF 1 and quantity 1, growth **0%**, autonomy **15 minutes**, chemistry **Li-ion**, nominal DC bus **384 V**, module voltage **51.2 V**. Other defaults remain. Use the sample project. This module/bus combination is also produced by the chemistry-switch handler when starting with the default 384 V VRLA setup.

| Quantity | Current output | Physical series-string arithmetic |
| --- | --- | --- |
| Rounded series count | 8 modules | 8 modules |
| Requested nominal bus | 384 V | A request, not the resulting string voltage |
| Actual nominal string | Mismatch note only | **8 × 51.2 = 409.6 V** |
| Selected capacity | One string, 50 Ah modules | 50 Ah in series |
| Installed nominal energy | 19.2 kWh | **409.6 × 50 / 1000 = 20.48 kWh** |
| End voltage under existing LFP approximation | 336 V, based on request | **358.4 V**, if this physical string is explicitly accepted |
| Maximum DC current | 31.661601 A | **29.682751 A**, under that accepted-string approximation |

Pdc is **10.638298 kW**. Current calculation is `Pdc × 1000 / Vend`. The current report source prints the false equality **`384 V = 8 × 51.2 V`**. A mismatch note does not correct that equation or the downstream calculations.

The 409.6 V alternative is **not automatically an approved replacement** for a 384 V UPS bus. Its compatibility with the inverter, charger, BMS, operating-voltage window and module series limits must be established. The numbers above demonstrate internal inconsistency, not a manufacturer-approved design.

Required correction:

1. Separate requested UPS bus voltage from actual battery-string nominal voltage. Do not silently round hardware count and continue as if the request were physically realized.
2. Prefer a bounded validation fix: require a compatible integer series configuration, or expose the actual candidate voltage and mark its UPS compatibility unverified until explicitly configured. Do not silently change the bus when the user switches chemistry.
3. If supporting an explicitly accepted actual-string voltage, use it consistently for nominal energy, capacity/runtime calculations and the existing end-voltage approximation. Retain the requested bus separately. Validate manufacturer operating-voltage and series limits when data are available; do not invent them.
4. The report must distinguish requested and actual values and never print an incorrect equality. Unsupported configurations must not look like fully sized valid systems.
5. Preserve the Batch 7 kW/kVA loading and DC-breaker no-fit corrections. Recompute breaker requirements from the consistent DC-current basis. Keep the existing generic battery-rate model labelled as an estimate.

Acceptance checks:

- Reproduce the fixture: reject/flag the incompatible or unverified configuration, or show an explicitly accepted 409.6 V actual string with internally consistent results. Never print `384 = 8 × 51.2`.
- Preserve exact configurations: **384 V / 12 V = 32 VRLA blocks** and **512 V / 51.2 V = 10 Li-ion modules**.
- Test chemistry switching from the default bus without silently upgrading compatibility or retaining contradictory results.
- Test module voltage greater than requested bus and ratios close to half-integer boundaries.
- Assert installed energy equals actual nominal series voltage × installed Ah; all capacity/current/runtime consumers must use the declared voltage basis.
- Verify page/report consistency and distinguish an invalid voltage configuration from no-fit battery capacity or no-fit DC protection.

Engineering basis: series battery voltages add while string Ah follows the series units; compatible series configurations and limits depend on the battery/UPS system. This source illustrates series-bank arithmetic, not approval of this high-voltage synthetic fixture. [Victron Energy — battery-bank wiring](https://www.victronenergy.com/media/pg/The_Wiring_Unlimited_book/en/battery-bank-wiring.html).

## Delivery requested from Claude

For each issue return changed files, corrected calculation basis, before/after fixture outputs and regression results. Preserve earlier fixes and list additional findings separately. Do not claim all PFC/UPS engineering or PDF layout verified by this batch.
