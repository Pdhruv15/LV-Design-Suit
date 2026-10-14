# Calculation methods, assumptions and limits

How the core network calculations in `src/calc/` work, which data they use, and where they stop
being valid. The hand-calculated reference cases in `src/calc/referenceCalcs.test.ts` check the
code against these formulas. They show that the code does what this page says. They do not show
that the method meets IEC 60909 or IEC 60364.

Symbols: U = line-to-line voltage (V), U0 = U / √3, Ib = design current (A), L = length (km),
R / X = conductor resistance / reactance (Ω/km), n = parallel runs, cos φ / sin φ = load power factor.

## Cable data (`cableTable.ts`)

| Source | Meaning | Shown as |
|---|---|---|
| `reference` | Built-in approximate values: Cu/XLPE/SWA multicore, free air, 30 °C. R20 is from IEC 60228; X and ampacity are typical figures. Also covers a Cables.xlsx row that still holds these values unchanged. | Report notice; failure in strict mode |
| `user` | A Cables.xlsx row with edited values but no **Manufacturer** and **Reference document** | Report notice; failure in strict mode |
| `manufacturer` | A Cables.xlsx row that names a manufacturer and a reference document | No notice |
| `fallback` | The size is missing from Cables.xlsx, so the reference value was used | To-do warning (failure in strict mode); report notice |

- `resolveCable(csa)` returns the data and its source. `getCable(csa)` returns only the data, as it did before.
- `cableDataStatus(project)` lists the source of every phase and protective-conductor size the project uses.
- `cableDataNotice(project)` is the line printed on the design report, the study reports (PDF and Word) and the SLD sheet.
- **Project → Final design: require manufacturer cable data** (`strictCableData`) turns every size without manufacturer data into a to-do failure. This blocks the "Resolve issues" readiness stage.

The app does not check the manufacturer values themselves. "Manufacturer" means only that the row
says where its numbers came from.

## Installation method (IEC 60364-5-52)

Each circuit has a reference installation method. Blank means **E**, free air or on a tray, which is how every circuit was rated before. The methods are E, C (clipped direct), B1 / B2 (conduit or trunking on a wall), A1 / A2 (conduit in an insulated wall), D1 (ducts in the ground) and D2 (direct in the ground).

Iz = It(method) × correction factors × runs:

| Method | It from | Temperature | Soil | Grouping (own parallel runs) |
|---|---|---|---|---|
| E | cable data `Rating (A)` | air, Table B.52.14 | — | tray route factor, else one layer on a tray |
| A1–C | `Rating <method> (A)` | air, Table B.52.14 | — | bunched, Table B.52.17 item 1 (on the safe side for C) |
| D1 | `Rating D1 (A)` | ground, Table B.52.15 (ref. 20 °C) | ducts, Table B.52.16 (ref. 2.5 K·m/W) | one cable per duct |
| D2 | `Rating D2 (A)` | ground, Table B.52.15 | direct, Table B.52.16 | touching, direct in the ground |

- **Rating source:** It for methods other than E comes from the `Rating A1 … D2` columns in Cables.xlsx, with the row's own source (manufacturer / user). The built-in reference table (`REFERENCE_METHOD_RATINGS`) is empty until the IEC 60364-5-52 Annex B tables are added from a verified copy of the standard. With no rating, Iz is not a number: the circuit fails with **DATA REQUIRED**, cable selection skips the size, and the to-do list and the report's pre-export check name it. No value is substituted.
- **Ground conditions:** ground temperature and soil thermal resistivity come from Project settings. Blank means the IEC reference (20 °C, 2.5 K·m/W), which the to-do list flags whenever a circuit is buried. Values outside the tables (10–50 °C, 0.5–3 K·m/W) are failures.
- **Not modelled:** depth of laying, spacing between buried circuits other than touching, and grouping between different circuits that are not on a tray route.

## Ambient temperature derating

The factor is interpolated from the 90 °C XLPE column of IEC 60364-5-52 Table B.52.14 (reference
30 °C ambient) over the supported range **25–70 °C**. The factor is not extrapolated outside that range:

- Below 25 °C, the 25 °C factor (1.03) is used. This is conservative, and the to-do list shows a warning.
- Above 70 °C, the 70 °C factor (0.58) would overstate the rating. The to-do list shows a **failure**.
- A non-numeric ambient gives a NaN factor, so every rating check fails rather than passing with 1.0.

The Quick calculator already rejects an ambient outside 25–70 °C.

Note: the table's 25 °C point is 1.03. The XLPE column of Table B.52.14 is understood to list 1.04
(to be confirmed against the standard). Using 1.03 is slightly conservative. It has not been changed.

## Resistance at operating temperature

R = R20 × k. With no conductor temperature set, k = 1.2 (≈ 70 °C). With a temperature θ set
(Project → Conductor temperature for voltage drop), k = 1 + 0.00393 × (θ − 20), the copper
temperature coefficient. Skin and proximity effects are ignored.

## Voltage drop

- **Three-phase** (3/4-core): ΔU% = √3 · Ib · L · (R cos φ + X sin φ) / n / U × 100
- **Single-phase** (2-core): ΔU% = 2 · Ib · L · (R cos φ + X sin φ) / n / U0 × 100. This counts the phase and neutral loop.
- **Incomer to a sub-board** (ENG-005): each phase conductor uses the downstream board's real and reactive power on that phase. ΔU% = L · (R · P/U0 + X · Q/U0) / n / U0 × 100, and the worst phase is used. For balanced load this equals the three-phase formula. It is a phase-conductor approximation, not an unbalanced load flow, and it ignores neutral displacement.
- **Cumulative**: the drop at a feeder's end is the sum of the percentage drops of every incomer above it plus its own drop. This is a radial, first-order sum, not a load-flow solution.

## Short circuit — simplified IEC 60909-0, preliminary

- **Transformer**: |Z| = U² · uk / S. It is split into R and X by the X/R ratio (default 5).
- **Upstream MV network**: treated as infinite (zero impedance). This gives a higher maximum, so it is conservative for breaking capacity.
- **Maximum three-phase fault** (breaking capacity, selectivity, busbar ratings): Ik″ = c_max · U / (√3 · |Z|), where Z is the phasor sum of the transformer and every cable above the point. **c_max = 1.05**, which IEC 60909-0 Table 1 gives for LV systems with a +6 % tolerance (1.10 for +10 %). Cable R is taken at **20 °C**: a cold cable gives the highest current.
- **Line-to-neutral fault at the end of a 2-core circuit**: Ik1 = c_max · U0 / |Z_T + 2 · Z_cable|, with the cable at 20 °C.
- **Minimum fault for earth-fault disconnection** (earthing study): c_min = 0.95, with the phase and protective conductors at operating temperature (1.2 × R20).
- **Main board without transformer kVA / %Z**: a placeholder impedance of 0.01 Ω is used (≈ 25 kA at 415 V with c_max), and the to-do list shows a warning.
- **Not applied**: the transformer correction factor K_T, motor contribution, generation and loads. For this reason the method is described as simplified and preliminary, not a full IEC 60909 study.

### Change in v1.37

Up to v1.36 the maximum used c = 1 and cable R at 1.2 × R20, which gave results below an IEC 60909 maximum. Now:

| Case (1000 kVA, 5 %, 415 V) | Before (c = 1, 1.2 × R20) | Now (c_max = 1.05, R20) | Increase |
|---|---|---|---|
| LV busbar | 27.82 kA | 29.22 kA | +5 % |
| End of 50 m, 4C 50 mm² | 8.61 kA | 10.29 kA | +20 % |

Breakers whose breaking capacity Icu sat just above the old value can now fail the check. For example, the sample project's DB-GF1 busbar rose from 9.00 kA to 10.66 kA, so its 10 kA MCBs were changed to 15 kA. The pandapower comparison applies c = 1.10 and K_T, so it can come out slightly higher again.
