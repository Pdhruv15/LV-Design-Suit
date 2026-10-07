# Claude correction brief — Engineering Batch 4

Reviewed on 3 October 2026 against commit `4ead201`.

Correct only **ENG-007** and **ENG-008** below. Keep each correction separately reviewable and preserve earlier batches. Explain the changed files, calculation method, before/after results and validation. Stop after these two corrections so the owner can verify them.

This review changed no application code. Fixtures were executed through `sizePv` and PDF-source HTML generation in memory. The existing UPS/PV test file passed **9 tests**, and TypeScript checking passed. Browser behavior and rendered PDF layout were not verified. Passing existing tests does not validate the two defects below.

## ENG-007 — Separate Voc and Vmp temperature calculations

**Priority: high.** Location: Solar PV → panel datasheet → string design.

`sizePv` applies `betaVocPct` to both open-circuit voltage and maximum-power voltage. These are different operating points; the Voc coefficient does not establish the Vmp coefficient. There is no separate Vmp coefficient input. Consequently the app can report that a hot string meets the MPPT minimum without sufficient data to establish that result.

Files:

- [solar.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/solar.ts:150): panel type/defaults, hot/cold Vmp and minimum/maximum string length.
- [SolarStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/SolarStudy.tsx:97): panel inputs, validation and displayed string checks.
- [upsSolarReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/upsSolarReport.ts:74): method inputs and string checks in PDF-source HTML.
- [upsSolar.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/upsSolar.test.ts:60): the existing test repeats the Voc coefficient in its expected Vmp formula; revise the engineering expectation.

Executed fixture: `PV_DEFAULTS`, target **3.3 kWp**, inverter **3 kW**, MPPT minimum **210 V**, supply **400 V**. All other defaults remain. For the corrected comparison, explicitly supply an independent Vmp coefficient of **−0.40%/°C**. This is a synthetic verification input, not a claimed datasheet value for the generic panel.

The app's existing NOCT approximation gives maximum cell temperature `48 + (45 − 20) / 800 × 1000 = 79.25°C`.

| Quantity | Current result | Expected with supplied Vmp coefficient |
| --- | --- | --- |
| Hot panel Vmp | 35.5919925 V | **32.6511 V** |
| Minimum panels per string | 6 | **7** |
| Hot voltage of six panels | 213.551955 V, passes 210 V | **195.9066 V**, below 210 V |
| Cold panel Voc | 51.6088 V | **51.6088 V**, unchanged |

Current sizing selects six panels / one string, status `ok`. Generated report HTML prints `6 × 35.59 = 214 V ≥ 210 V OK`. With the supplied Vmp coefficient, seven panels would give **228.5577 V** and **3.85 kWp** under the existing target-round-up rule. Cold Vmp should be **44.202 V**.

Reference arithmetic: `Vmp(T) = 41.7 × [1 + (−0.40 / 100) × (T − 25)]`. Continue to use the separate **−0.27%/°C Voc coefficient** for Voc.

Required correction:

1. Add an explicit, independently sourced Vmp temperature coefficient, or implement a documented PV model that actually determines Vmp versus temperature. For a bounded correction, a separate `betaVmpPct` input and the existing linear approximation are sufficient. Label the method as an approximation.
2. Use the Vmp basis for both hot minimum-MPPT and cold maximum-MPPT checks and string selection. Keep Voc on its own coefficient. Do not substitute the power coefficient directly for a voltage coefficient without a justified model.
3. Preserve older project files. Missing Vmp data must produce an explicit unverified/estimated MPPT state rather than silently treating Voc as a verified Vmp coefficient. If providing a generic estimate, identify its provenance and assumption in the UI and report; do not claim a manufacturer verification.
4. Show both coefficients and their units in the report, including any missing-data warning. Preserve the existing yield power coefficient, NOCT approximation and phase propagation from Batch 3.

Acceptance checks:

- Reproduce the fixture above with distinct Voc/Vmp coefficients and assert the numerical results and corrected string selection.
- Change only the Vmp coefficient: MPPT results may change, but cold Voc must not.
- Exercise the cold MPPT upper bound, hot lower bound and a case where no string length fits.
- Open a legacy project without Vmp data and verify the missing/estimated-data state is visible in both UI and report and is not silently upgraded by merging generic defaults.
- Verify saved explicit coefficients survive reload and report generation uses the same calculation basis.

Engineering basis: PVsyst treats module operating voltage through its PV model and distinguishes Voc sizing data from operating behavior; its component tutorial discusses module temperature modeling and inverter MPPT limits. This supports separate treatment, not a mandate to reproduce PVsyst's complete model. [PVsyst components database tutorial](https://www.pvsyst.com/pdf/pdf-tutorials/pvsyst-8/pvsyst-tutorial-v8-components-database-en.pdf).

## ENG-008 — Report no suitable AC breaker instead of clamping to 2,500 A

**Priority: high.** Location: Solar PV → AC connection → exported report.

The Solar breaker list ends at 2,500 A. When no rating meets `acCurrentA × 1.25`, the fallback returns its largest entry without marking a failure. A breaker smaller than the load can therefore appear as a successful recommendation. This defect is independent of whether the 1.25 multiplier is the final approved project policy.

Files:

- [solar.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/solar.ts:192): selection fallback, result type, status and notes.
- [SolarStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/SolarStudy.tsx:140): selected breaker and failure display.
- [upsSolarReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/upsSolarReport.ts:71): selected breaker and failure display.
- [pvFeeder.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/model/pvFeeder.ts:8): review the Add/Update path so unresolved protection cannot be presented as successfully sized. It currently accepts only inverter count/kWp and sizes independently through general recommendation.

Executed fixtures: `PV_DEFAULTS`, three-phase supply **400 V**, inverter **250 kW**, **16 MPPTs**, input limit **50 A**, DC/AC target **1.2**. These inputs are synthetic calculation fixtures. MPPT current is **35 A** in both cases, so an unrelated input-current warning does not explain the result.

| Target | Selected array | Inverters / AC power | Load current | Required rating under existing ×1.25 policy | Current output |
| --- | --- | --- | --- | --- | --- |
| 2,000 kWp | 3,638 panels / 2,000.9 kWp | 7 / 1,750 kW | 2,525.907428 A | **3,157.384285 A** | 2,500 A, status `ok` |
| 5,000 kWp | 9,093 panels / 5,001.15 kWp | 17 / 4,250 kW | 6,134.346610 A | **7,667.933263 A** | 2,500 A, status `ok` |

Reference current: `I = total AC kW × 1000 / (√3 × 400)`. The second report literally prints `6,134 A → 2500 A breaker`; there is no no-fit protection note. Existing whole-string adjustment notes do not identify this problem.

Required correction:

1. Represent an unavailable selection explicitly, such as optional `acBreakerA` plus a no-fit state and required current. Mark unresolved AC protection as a failure. Never return an inadequate maximum rating as if it met the requirement.
2. UI and report must show **No suitable breaker in the available list**, required rating and the available maximum. Avoid `undefined A`, a fabricated rating or a success badge.
3. If intentionally adopting a broader shared catalogue, select a real available rating meeting the same chosen policy and document this decision. The first fixture may then fit a larger breaker; the second must remain unresolved when the list cannot meet 7,667.933263 A. An invented larger rating or automatic equal split is not a correction.
4. Check creation and update on the SLD. General recommendation has a distinct breaker policy (`I / 0.85`); preserve or explicitly reconcile that distinction. A suitable general recommendation should not be rejected solely because an obsolete Solar-only list is shorter. Conversely, if that path also has no suitable breaker/cable, do not silently keep a placeholder or old rating and announce a successful sizing. Surface the unresolved recommendation and guard application appropriately.
5. Do not implement automatic parallel inverter groups, multiple feeders, voltage changes or network redesign in this batch. State that such a design requires explicit configuration when a single aggregate connection cannot be sized.

Acceptance checks:

- Reproduce both fixtures and ensure every displayed selected rating is at least the policy requirement, or explicitly no-fit.
- Test a requirement exactly equal to the largest available rating and one just above it; the former fits, the latter must not clamp.
- Cover a normal three-phase case (default 50 kW at 400 V selects 100 A) and a one-phase case, preserving Batch 3's current/voltage basis.
- Verify UI/report failure parity and that Add/Update cannot present unresolved protection as an adequate generated feeder.
- Preserve zero-array behavior without suggesting that a zero-generation connection needs a valid engineered protection design.

Engineering basis: protective-device rating must cover design current while respecting conductor capacity. This reference supports the no-undersized-selection requirement; it does not independently establish the app's 1.25 multiplier for every installation. [Schneider Electric — practical values for a protective scheme](https://www.electrical-installation.org/enwiki/Practical_values_for_a_protective_scheme).

## Delivery requested from Claude

For each issue provide changed files, explanation of the corrected basis, executed before/after fixture outputs and meaningful regression checks. Keep calculation, UI and report results consistent. Flag any additional issue separately without silently expanding this batch. Do not declare the full PV design, all engineering calculations or PDF layout validated by these two corrections.
