# Claude correction brief — Engineering Batch 7

Reviewed on 3 October 2026 against commit `77a445e`.

Correct only **ENG-013** and **ENG-014**. Preserve earlier batches, explain each change separately and stop after these two issues for owner verification.

No application code was changed by this audit. Fixtures were executed through `sizeUps` and `buildUpsReportHtml` in memory. Existing UPS/PV tests passed **9 tests**, and TypeScript checking passed. Browser interaction and rendered PDF layout were not verified.

## ENG-013 — Report UPS loading against both kVA and kW limits

**Priority: high.** Location: UPS study → rating/loading today and exported UPS report.

UPS selection correctly checks both kVA and rated kW, but `loadingPct` uses only `loadKva / upsKva`. The unqualified loading display can imply spare capacity when the UPS has already reached its real-power limit.

Files:

- [ups.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/ups.ts): `UpsResult`, `sizeUps` loading calculation.
- [UpsStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/UpsStudy.tsx:156): loading-today display.
- [upsSolarReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/upsSolarReport.ts:36): report loading row.
- [upsSolar.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/upsSolar.test.ts): regression coverage.

Executed fixture: `UPS_DEFAULTS`, ID/name T; one load of **96,000 W**, quantity 1, PF **1**; growth **0%**, maximum design loading **100%**, UPS rated output PF **0.8**, autonomy **5 minutes**. Other defaults unchanged; use the sample project.

| Quantity | Current output | Required interpretation |
| --- | --- | --- |
| Load | 96 kVA / 96 kW | Unchanged |
| Selected UPS | 120 kVA / 96 kW | Unchanged |
| Apparent-power loading | 80% | **80% of kVA rating** |
| Real-power loading | Not shown | **100% of kW rating** |
| Unqualified loading today | 80% | **100%, governed by kW**, or show both explicitly |

The generated report prints `Loading today: 80 %`. A second executed fixture with **600 kW**, otherwise the same inputs, selects **800 kVA / 640 kW** and prints **75%** loaded. Actual utilization is **75% of kVA** and **93.75% of kW**.

Reference arithmetic: `loadingKvaPct = 100 × loadKva / upsKva`, `loadingKwPct = 100 × loadKw / upsKw`. If retaining a single overall utilization value, use their maximum and identify the governing limit.

Required correction:

1. Calculate both utilization ratios. Label each explicitly and identify the governing constraint. An unqualified overall loading figure must reflect the larger ratio.
2. Preserve the distinction between today's load and growth-adjusted design requirement. Do not apply growth twice or divide actual loading by the design-loading percentage.
3. Keep the existing two-limit UPS selection intact. Update UI/report together and avoid implying spare kW capacity from a lower kVA percentage.
4. Handle unavailable/zero ratings without Infinity, NaN or a success indication. Preserve the existing no-suitable-UPS message.

Acceptance checks:

- Reproduce both fixtures and assert both ratios and the governing displayed value.
- Add a kVA-governed case: **96 kVA at load PF 0.6**, rated UPS output PF 0.8, growth 0%, design loading 100%. The selected 100 kVA / 80 kW unit has **96% kVA utilization** and **72% kW utilization**.
- Verify rated output PF 1 gives equal ratios for a unity-PF load.
- Verify growth changes selection/design requirements while today's numerator remains the actual load.
- Verify UI/report parity and no-fit behavior.

Engineering basis: UPS output has independent apparent- and real-power limits; whichever is reached first governs available capacity. [Schneider Electric UPS specification — kVA or kW limit reached first](https://iportal.se.com/Contents/docs/UPS-JPRO-8URQH4_R1_EN.PDF).

## ENG-014 — Do not clamp an unavailable UPS DC breaker to 1,600 A

**Priority: high.** Location: UPS battery sizing → DC connection and report.

The DC breaker list ends at **1,600 A**. `sizeUps` falls back to that rating whenever no entry meets `dcCurrentMaxA × 1.25`. It does not flag the unmet requirement. This is the UPS DC counterpart of the previously reviewed Solar AC fallback; the earlier Solar correction does not fix this separate code path.

Files:

- [ups.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/ups.ts): `DC_BREAKERS`, selection fallback, `UpsResult` and notes.
- [UpsStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/UpsStudy.tsx:159): DC-side result and unresolved-protection display.
- [upsSolarReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/upsSolarReport.ts:49): maximum current/breaker row.
- [upsSolar.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/upsSolar.test.ts): boundary and report regression checks.

Executed fixture: the same setup as ENG-013, except one **600,000 W** load, quantity 1 and PF 1. Growth 0%, design loading 100%, output PF 0.8, autonomy 5 minutes. Default inverter efficiency **0.94**, nominal DC bus **384 V**, VRLA **12 V blocks**, end voltage **1.75 V/cell**, and the default battery factors/capacity tables.

The selected UPS is **800 kVA / 640 kW**. The battery algorithm selects **four parallel strings**, **32 blocks per string**, **200 Ah blocks**. Thus this fixture does not rely on an unrelated no-fit UPS or unavailable battery size.

| Quantity | Current result | Required behavior |
| --- | --- | --- |
| DC discharge power | 638.297872 kW | Unchanged under existing model |
| End-of-discharge bus voltage | 336 V | Unchanged |
| Maximum aggregate DC current | 1,899.696049 A | Unchanged |
| Minimum rating under existing ×1.25 policy | 2,374.620061 A | Show this requirement |
| Selected breaker | 1,600 A | **No suitable rating in current list** |

Reference arithmetic: `Pdc = 600 / 0.94`, `Vend = (384 / 2) × 1.75 = 336 V`, `Imax = Pdc × 1000 / Vend`, required rating `= Imax × 1.25`.

Generated HTML prints `1,900 A (end of discharge) / 1600 A`. The result notes only say `4 strings in parallel`; they do not identify inadequate aggregate DC protection.

Required correction:

1. Represent no suitable DC breaker explicitly, e.g. optional selected rating plus required current and a failure flag/message. Never present the maximum entry as meeting an unmet requirement.
2. Show the unresolved DC protection in both UI and exported report, including required rating and available maximum. Avoid `undefined A`, fabricated selections or a success presentation.
3. If expanding the catalogue, use real available DC-rated devices and retain no-fit handling above the actual supported maximum. An AC rating alone does not establish DC voltage, pole arrangement or interrupting suitability.
4. Clearly state whether the recommendation is for the aggregate battery bus or an individual string. The present calculation uses aggregate power/current. Do not divide by the number of strings and relabel that result as aggregate protection. Per-string protection and aggregate protection are different design checks.
5. Preserve the existing multiplier as app policy for this bounded fix. Do not claim that current-rating selection alone validates DC interruption, cable protection, isolation or the full battery design. Do not introduce automatic parallel breakers as a workaround.

Acceptance checks:

- Reproduce the fixture: current approximately 1,899.696049 A, policy requirement approximately 2,374.620061 A, no fit in the current list, visible in UI/report.
- Test a required rating equal to the largest available entry and one just above it: the first fits, the second must not clamp.
- Preserve the ENG-013 96 kW fixture: maximum DC current **303.951368 A**, policy minimum **379.939210 A**, selected **400 A**.
- Cover VRLA and Li-ion end-voltage paths and ensure the selection uses their actual calculated maximum current.
- Keep no-fit UPS, no-fit battery and no-fit DC protection distinct so one warning cannot conceal another.
- Verify any changed result types across all callers and exported reports.

Engineering basis: the protective-device current rating must cover design current and suit the protected circuit. This source supports rejecting an undersized rating; it does not independently establish the app's multiplier or prove DC-device suitability. [Schneider Electric — practical values for a protective scheme](https://www.electrical-installation.org/enwiki/Practical_values_for_a_protective_scheme).

## Delivery requested from Claude

For each issue provide changed files, corrected calculation basis, before/after fixture outputs and meaningful regression-test results. Preserve prior corrections and report additional findings separately. Do not declare all UPS engineering or PDF layout verified by this batch.
