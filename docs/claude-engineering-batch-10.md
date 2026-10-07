# Claude correction brief — Engineering Batch 10

Reviewed on 3 October 2026 against commit `47774a8`.

Correct only **ENG-019** and **ENG-020**. Preserve previous batches, explain each change separately and stop after these issues for owner verification.

No application code was changed by this review. Fixtures were executed in memory. Existing earthing tests passed **8 tests**, and TypeScript checking passed. UI/report consumers were identified from source; browser interaction and rendered PDF layout were not verified.

## ENG-019 — Treat missing source-loop data as unknown, not zero

**Priority: high.** Location: Earthing study → source loop, fault current and disconnection results.

`earthLoopToBoard` returns zero impedance when source transformer data are absent, a board is missing or a recursion cycle is detected. A missing connecting incomer also silently returns only the upstream impedance. `evaluateEarthing` then evaluates the incomplete path as if it were a known complete supply, potentially showing `ok`.

Files:

- [earthing.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/earthing.ts): `earthLoopToBoard`, path validation and `evaluateEarthing` result/status.
- [EarthingStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/EarthingStudy.tsx): unavailable source/path presentation.
- [report.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/report.ts) and [studyReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/studyReport.ts): earthing report rows and summaries.
- [earthing.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/earthing.test.ts): missing-data and broken-path regressions.

Executed fixture: supply **400 V**, one board MDB with **no source kVA or impedance data**. Feeder F: **50 m**, phase/CPC **4 mm²**, one four-core run, **32 A** default type-C breaker, no RCD. Load 5 kW, PF 0.9, DF 1. Other project fields can use the sample project.

| Quantity | Current result | Required interpretation |
| --- | --- | --- |
| External/source loop Ze | 0 Ω | **Unknown**, not a verified ideal source |
| Calculated Zs | 0.553218302 Ω | Cable-only partial impedance |
| Fault current | 396.576002 A | Conditional on an assumed zero source impedance |
| Disconnection and overall status | `ok` | **Not verified: source data missing** |

Independent sensitivity calculation: the existing cable loop is R **0.5532 Ω**, X **0.0045 Ω**. Adding a hypothetical external resistance of **0.5 Ω** gives `If = 0.95 × (400 / √3) / hypot(0.5 + 0.5532, 0.0045) = 208.309058 A`, below the breaker's **320 A** guaranteed magnetic threshold. This is a synthetic sensitivity example, not a claim about the real supply. It demonstrates why missing data cannot prove instantaneous operation. Whether the actual device still clears within its required time needs its applicable curve.

Control fixture: supply board with **1,000 kVA / 5% impedance**, default transformer X/R, otherwise the same feeder. Current results are Ze **0.008 Ω**, Zs **0.554906258 Ω**, fault current **395.369667 A**. Preserve this known-source calculation.

Required correction:

1. Return impedance together with validity/provenance, or another explicit unavailable state. Propagate missing source data, missing board, missing connecting feeder and cycles to the study result.
2. Do not substitute zero for unknown source impedance. If offering an ideal-source estimate, require an explicit assumption and label the resulting calculation unverified for compliance.
3. UI/report must distinguish unavailable fault-current/thermal/disconnection verification from a known numerical pass. Do not emit Infinity/NaN or green success when the path is incomplete.
4. A measured/external Ze input may be added if appropriate, but do not invent typical utility data. Preserve transformer-derived TN-S assumptions and their limitations.
5. Keep existing parallel-CPC assumptions from Batch 6 visible. An RCD may establish a separate protection criterion when enough data are available, but it must not manufacture a known fault current or thermal result from an unknown supply.

Acceptance checks:

- Reproduce missing-source and known-source fixtures above.
- Exercise missing board, broken incomer connection and a cyclic board path; all must expose incomplete verification without silently dropping impedance.
- Test zero-length cable plus missing source so an infinite calculated fault current cannot become a successful result.
- Verify UI/report summaries retain missing-data warnings and do not count unavailable checks as passes.
- If measured Ze is supported, test its contribution and provenance explicitly.

Engineering basis: the earth-fault loop includes source, phase and protective return-path impedance. [Schneider Electric — TN-system principle](https://www.electrical-installation.org/enwiki/TN_system_-_Principle).

## ENG-020 — Classify final circuits correctly when selecting disconnection time

**Priority: medium.** Location: Earthing study → required disconnection time and associated report basis.

`requiredDisconnectionS` returns **0.4 s for every final circuit rated up to 63 A**, regardless of whether it supplies socket outlets or fixed equipment. Its comment describes this as the standard rule. Under the cited 230 V-to-earth TN basis, the thresholds differ: socket-outlet final circuits up to 63 A and fixed-equipment-only final circuits up to 32 A receive the short limit. Other eligible circuits use 5 s.

The existing 0.4 s requirement for 40–63 A fixed equipment is conservative, but it is incorrectly labelled as the general standard requirement and can generate unnecessary failures. Changing its label/time must not turn an unverified thermal-region check into a pass.

Files:

- [earthing.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/earthing.ts): `requiredDisconnectionS`, standard comments and time-dependent evaluation.
- [types.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/types.ts): circuit-purpose metadata if the existing load classification is insufficient.
- [EarthingStudy.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/components/studies/EarthingStudy.tsx), [report.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/report.ts), [studyReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/studyReport.ts): time and assumption presentation.
- [earthing.test.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/earthing.test.ts): existing test currently expects the overgeneralized 63 A rule.

Executed classification fixtures: final feeder, no `feedsBoardId`, breaker **40 A**. Changing only `loadType` between `motor` and `sockets` returns **0.4 s for both**. For the corrected comparison, explicitly classify the motor as fixed-connected only and the socket feeder as containing socket outlets, within the nominal 230 V TN basis.

| Circuit under that basis | Current required time | Correct standard classification |
| --- | --- | --- |
| 40 A fixed-equipment-only final circuit | 0.4 s | **5 s**, unless a stricter project rule applies |
| 40 A final circuit including sockets | 0.4 s | **0.4 s** |
| 32 A fixed-equipment-only final circuit | 0.4 s | **0.4 s** |
| Distribution circuit | 5 s | **5 s** |

Required correction:

1. Determine circuit purpose explicitly. Use existing metadata only where it establishes socket/fixed connection; a load icon alone must not silently relax the requirement. For unknown purpose, retain a conservative assumption and label it, or require classification.
2. Apply separate rating thresholds under the selected standards basis. If the product intentionally adopts a stricter authority/project rule, retain it as a disclosed project override rather than claiming it is the cited general rule.
3. Include the earthing arrangement and nominal voltage-to-earth basis in applicability. The current helper accepts only a feeder and cannot support all voltage/time bands. Either support the relevant standard table with verified inputs or clearly restrict this calculation to its supported TN voltage basis. Do not silently apply 0.4/5 s to arbitrary supplies or TT systems.
4. Keep required time separate from demonstrated trip time. A 5 s allowance below the guaranteed magnetic threshold remains **thermal curve verification required** until supported manufacturer data prove compliance. Do not reuse the generic plotting curve as certification data.
5. Review time-dependent thermal estimates and labels after classification changes. Preserve Batch 6 topology warnings and ENG-019 missing-source handling.

Acceptance checks:

- Verify the four cases above and the 32/63 A boundaries with explicit circuit purpose.
- Test unknown/mixed-purpose circuits without an unsafe automatic relaxation.
- Test known stricter project settings without hiding the override.
- Verify unsupported voltage/earthing basis produces an explicit assumption or unverified state.
- Verify a fixed 40 A circuit below magnetic trip retains a curve-check warning rather than automatically passing because 5 s is allowed.
- Keep UI/report required-time and proof-status consistent.

Standards basis: the IET reference distinguishes socket and fixed-only circuit thresholds and states that required time also depends on voltage and earthing arrangement. It describes BS 7671's TN examples; applicability to the project's authority must be checked rather than silently assumed. [IET — maximum loop impedance and disconnection-time classification](https://electrical.theiet.org/wiring-matters/years/2023/94-march-2023/determining-the-maximum-earth-fault-loop-impedance-for-protective-devices-to-bs-en-60898-bs-en-60947-2/).

## Delivery requested from Claude

For each issue provide changed files, corrected basis, before/after fixtures, meaningful regression results and remaining assumptions. Preserve earlier fixes and list additional findings separately. Do not claim complete earthing compliance or PDF-layout verification from this batch.
