**Claude correction brief — Engineering Batch 2**

Review baseline: commit `29f28a9`, 3 October 2026.

Please correct only the two issues below: **ENG-003** and **ENG-004**. Keep their changes separately reviewable. ENG-001 and ENG-002 have already been verified. The owner wants small batches with clear before-and-after results.

Both findings were reproduced against the current calculation functions and Study Report section builder. This document requests implementation; no application code was changed during this review.

**ENG-003 — Generator selection must satisfy both kW and kVA capacity**

Priority: high. App location: **Transformer & generator sizing**, plus dropping a generator onto a board in the SLD.

Current selection checks running kVA, while the board-sizing result declares the selected set's rated kW as `0.8 × rated kVA`. The selection never checks that kW capacity. At the default 80% loading target, this can consume the requested kW allowance. At a 100% loading setting, it can select a set whose rated kW is below the actual running demand.

Primary calculation files:

- [sizing.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/sizing.ts:88): `generatorForBoard`, and `sizeGenerator` at line 117.
- [txGen.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/txGen.ts:203): `sizeGeneratorByBoards`, including the soft-start alternative.

Use an isolated project with 400 V three-phase supply, one MDB and one essential **nonmotor** general load. Set demand factor and load PF to 1. Use no other loads, capacitor banks or generation. Select the MDB at 100% in the board-sizing plan, or give it a standby generator so the whole board is selected automatically. Count the essential circuit once.

The following values were executed with the current built-in size list and its 0.8 rated-PF assumption:

| Running demand | Max loading | Current result | Required corrected result |
| --- | --- | --- | --- |
| 100 kW / 100 kVA | 100% | 100 kVA / 80 kW | **125 kVA / 100 kW** |
| 100 kW / 100 kVA | 80% | 125 kVA / 100 kW; engine at 100% | **200 kVA / 160 kW**; engine at 62.5% |
| 2100 kW / 2100 kVA | 100% | 2500 kVA / 2000 kW | **No suitable standard set**; minimum equivalent rating 2625 kVA |

The 80% case needs at least 156.25 kVA; 150 kVA is insufficient, and the next built-in size is 200 kVA. For the first case, a currently installed 100 kVA set also produces a Study Report result of `Within limit`; after correction it must be insufficient.

Required correction:

1. Use the same running-capacity rule in all three generator selection functions. For loading fraction `L`, every candidate must satisfy `ratedKva × L >= demandKva` and `ratedKw × L >= demandKw`.
2. Under the existing 0.8 rating model, the required running rating is `max(demandKva / L, demandKw / (0.8 × L))`. Keep **load PF**, **generator rated PF**, and **design loading fraction** distinct. The two 0.8 factors in the default unity-PF example represent different constraints.
3. In board sizing, retain the motor-start constraint: select a candidate meeting both running constraints and `startDesignKva`. Apply the loading allowance once. The existing motor-start required rating must not be divided by loading again. Keep transformer future-growth settings out of generator sizing.
4. Apply the same running-capacity floor to the soft-start alternative. A smaller starting demand cannot justify a set below the required running kW capacity. Update the explanation of which constraint governs selection.
5. Keep reported rated kW consistent with the rating used for selection. If a matching existing catalogue candidate supplies a valid kW rating, use that rating consistently; otherwise make the existing `0.8 × kVA` fallback explicit. A catalogue/schema redesign is outside this batch.
6. Return and display a no-fit result when no candidate meets both capacities. `generatorForBoard` currently clamps to 2500 kVA. Its SLD caller must handle no-fit without installing an undersized set. Preserve deliberate empty-board placement behavior separately from positive demand that cannot fit.
7. Update sizing UI and report method text to show the kW constraint, governing requirement and no-fit reason. Installed-set checks and dashboard messages must use the corrected recommendation. Verify their numeric values as well as labels.

Affected consumers to check:

- [SizingStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/SizingStudy.tsx:193): running requirement, motor/soft-start explanations, recommendation, installed-set comparison, no-fit display.
- [sldEdit.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/model/sldEdit.ts:280): generator placement and handling a missing suitable rating.
- [studyReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/studyReport.ts:312): requirement, method text, section status and size table.
- [report.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/report.ts:89) and [dashboard.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/dashboard.ts:169): recommendation and above-range messages.

Acceptance checks:

- Add regression tests for all three numerical rows above, including both essential-load and board-sizing paths and `generatorForBoard`.
- For the 100 kW / 100% case, an installed 100 kVA set fails; an installed 125 kVA / 100 kW set meets the running requirement under the fallback model.
- A 100 kW load at PF 0.8 with 80% loading still selects 200 kVA; at PF 0.6 it still selects 250 kVA. Do not enlarge low-PF cases unnecessarily.
- Preserve covered-board deduplication, demand factors, board shares and empty-load behavior.
- Retain motor-dominant cases and add a case proving the soft-start alternative respects the running kW floor.
- Assert that no-fit appears as a failure with the governing requirement in report data and that SLD placement does not silently clamp.

Engineering basis: Cummins describes the distinction between load PF and generator ratings, including typical three-phase ratings at 0.8 PF. The requirements and numerical examples above are derived from this app's declared rating model and loading settings. [Cummins — How to size a genset](https://mart.cummins.com/imagelibrary/data/assetfiles/0056648.pdf).

**ENG-004 — Proposed transformer split must not count as installed capacity**

Priority: high. App location: **Transformer & generator sizing → transformer table**, and its study/calculation report outputs.

Primary file: [txGen.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/txGen.ts:149), `sizeTransformers`.

Current code evaluates installed adequacy using:

```ts
installedKva * split >= designKva - 1e-6
```

`split` is the number of units proposed for the design. It is not an installed count. The current model stores the source rating on `Board.sourceKva`; the sizing UI describes the proposal as splitting into additional boards and hides Apply to SLD when `split > 1`.

Executed reproduction: one MDB with one installed 1500 kVA transformer, one 2500 kW load at PF 1 and DF 1, future growth 0%, transformer max loading 100%, DEWA size list, planned PFC disabled. Give the busbar and breakers sufficient ratings to isolate this defect.

| Item | Current result | Required corrected result |
| --- | --- | --- |
| Demand / design | 2500 kVA | 2500 kVA |
| Proposed recommendation | 2 × 1500 kVA | 2 × 1500 kVA |
| Actually installed | 1500 kVA | 1500 kVA |
| Installed loading | 166.67% | 166.67% |
| `adequate` | `true` | **`false`** |
| Study Report result | `Within limit`; 1 pass, 0 fail | **Insufficient / failing** |

Required correction:

1. Compare actual installed capacity directly with design demand: `installedKva >= designKva - 1e-6` under the existing single-source model.
2. Preserve `undefined` adequacy when no installed rating exists.
3. Keep the split recommendation visible as a proposal. Do not infer installed multiplicity from either `split` or the duty/standby plan. Do not add a parallel-transformer model in this batch.
4. Verify that the existing UI warning and report statuses consume the corrected result. The installed 1500 kVA source must remain insufficient while the 2 × 1500 kVA proposal remains visible.

Consumers:

- [SizingStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/SizingStudy.tsx:130): installed transformer warning.
- [studyReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/studyReport.ts:307): transformer status, section count and table result.
- [report.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/report.ts:88): installed adequacy wording.

Acceptance checks:

- Add the isolated 2500/1500 fixture to `txGen.test.ts`, asserting the recommendation, installed loading and `adequate: false` together.
- Add a report-section regression: the proposal stays 2 × 1500 kVA, the installed rating stays 1500 kVA at approximately 167%, and the transformer result/count is failing.
- Preserve equal-capacity behavior: design 1500 kVA with installed 1500 kVA is adequate.
- Preserve missing-installed behavior: no source rating gives undefined installed adequacy.
- Changing the proposal's split count must never multiply installed capacity.

**Verification and delivery**

Baseline: the six existing suites below passed **68 tests**, despite the reproduced defects. Add targeted regression coverage rather than changing expectations just to preserve the old behavior.

```sh
npm test -- src/calc/txGen.test.ts src/calc/sizing.test.ts src/calc/motor.test.ts src/model/sldEdit.test.ts src/docs/studyReport.test.ts src/docs/reportIntegrity.test.ts
npm run typecheck
```

Run any new regression files as well. Check the sizing screen and corresponding exported reports after the calculation fixes. If rendered PDF verification is unavailable, state that limitation and provide the report-data assertions.

Return a short result for **ENG-003** and **ENG-004** separately: changed files, what changed, before/after numbers, tests run, and any unresolved item. Stop after this batch so the owner can verify it before the next corrections.
