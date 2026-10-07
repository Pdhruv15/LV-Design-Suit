---
created: 2026-10-04
updated: 2026-10-04
status: open
tags: [enclosure, db, engineering-review]
---

# DB enclosure issues and solutions

Module: [[Enclosure sizing]]
Evidence: [[DB enclosure verification - 2026-10-04]]
Index: [[Issues and solutions]]

## Scope and result

DB enclosures only. MDB, SMDB and LVMDB enclosure sizing are excluded from the current verification because their supplier data is not available.

The local checkout tested was `b9b047d`. An update in another branch, folder or installed package has not been verified. Source files were not modified during the review.

- Existing automated tests: **24 passed** across enclosure, enclosure-library and load-schedule tests.
- Additional manual capacity cases: **338 passed**, including ELCB-count and capacity boundaries.
- Multiphase DB schedule cases: **28 failed** due to RCCB pole classification and consequent module undercounting.
- Additional control cases: **16 passed** for no ELCBs, individual RCBOs with the test mapping, same-phase groups and three-phase circuit groups.
- Existing sample DB: **21 circuits, 4 ELCB groups; expected 41 equipment modules, actual 33**, using the explicit fixture widths.

These results validate tested module arithmetic and expose counting defects. They do not establish manufacturing layout, thermal suitability or universal device widths.

## ENCL-001 — Multiphase RCCBs are counted as two-pole devices

**Status:** Open · **Priority:** High · **Evidence:** Executed reproduction.

Groups spanning R/Y/B through single-phase circuits are classified using cable-core count rather than phase coverage.

Example: 42 one-module MCBs + seven four-module RCCBs + four-module incomer + eight spare modules = **82 required modules**. The app counts the RCCBs as two-module devices and obtains **68 modules**, selecting 5 × 16 rather than the manually calculated 6 × 16 candidate.

**Proposed solution:** Determine actual group phase coverage and allow an explicit physical-device mapping. Retrieve width from the selected product record.

**Acceptance:** For the recorded fixture, the 42-circuit case must produce 82 required modules; all 28 recorded multiphase cases must match their independent manual totals. Retest actual supplier records separately.

Source: `src/model/enclosureLibrary.ts`, `neededDevices`.

## ENCL-002 — Circuits without phase/way can be silently omitted

**Status:** Open · **Priority:** High · **Evidence:** Executed reproduction.

When at least one scheduled circuit exists, the inventory uses only scheduled circuits. A DB containing six scheduled circuits plus one circuit without phase/way counts six instead of seven.

**Proposed solution:** Reconcile all physical DB outgoing devices against the schedule. Flag unresolved circuit allocation rather than silently dropping a device.

**Acceptance:** All seven devices must be represented or the result explicitly marked incomplete; it must not be presented as a complete enclosure estimate.

Source: `src/model/enclosureLibrary.ts`, `neededDevices`; `src/calc/loadSchedule.ts`, `scheduleCircuits`.

## ENCL-003 — Product width depends on library order

**Status:** Open · **Priority:** High · **Evidence:** Executed reproduction in the earlier enclosure review.

Matching uses only kind, poles and rating, then takes the first library record. Reversing two matching records changes the width from one module to two modules.

**Proposed solution:** Select manufacturer/model or a stable device-record ID for each equipment group. Require a choice when several records match.

**Acceptance:** Reordering the library must not change a selected panel's equipment widths or module totals.

Source: `src/model/enclosureLibrary.ts`, `matchDevice`.

## ENCL-004 — Physical 1P+N RCBO record cannot match

**Status:** Open · **Priority:** Medium · **Evidence:** Executed reproduction.

The automatic inventory requests poles = 1 for single-phase RCBO circuits. A dimension record stored with two physical poles is not matched. The code correctly leaves the device unmapped, but cannot represent the actual physical device through automatic matching.

**Proposed solution:** Separate circuit phase configuration from physical device poles and neutral switching, then bind an actual product record.

**Acceptance:** A selected two-pole/1P+N RCBO record must contribute its recorded width without requiring incorrect pole metadata.

## ENCL-005 — Manual mode lacks a device quantity breakdown

**Status:** Proposed solution · **Priority:** Medium · **Evidence:** Interface code review.

Manual mode accepts total equipment modules, spare modules and ELCB count. It does not calculate equipment space from manually entered quantities of MCBs, RCBOs, RCCBs, incomer and accessories.

**Proposed solution:** Add a manual equipment table: device/model, quantity, width per device and calculated subtotal. Sum the subtotals; apply spare space and catalogue allowances once.

**Acceptance:** The same complete device inventory entered manually or obtained from a schedule must produce identical equipment totals and catalogue decisions.

Source: `src/components/EnclosureSizing.tsx`.

## ENCL-006 — Fractional ELCB count is accepted

**Status:** Open · **Priority:** Medium · **Evidence:** Executed reproduction.

Manual sizing accepts ELCB count 1.5. Device quantities must be whole numbers; physical module widths can legitimately be fractional and need separate validation.

**Proposed solution:** Validate ELCB/device quantities as finite, nonnegative integers. Validate module widths according to the selected product data.

**Acceptance:** Fractional ELCB counts are rejected with a clear message; valid fractional product widths remain supported.

## Additional interface and catalogue findings from the earlier review

These remain open in the reviewed source. Interface findings were code-reviewed, not exercised in a live browser during the DB matrix run.

| ID | Finding | Proposed solution / acceptance |
|---|---|---|
| ENCL-007 | Switching the internal Panel dropdown retains the previous panel's manual inputs, catalogue and mounting. | Restore each panel's saved state, or explicitly initialize a new unsized panel. Verify switching between two differently sized DBs. |
| ENCL-008 | Reopening a panel does not restore its saved candidate; the page defaults to the first fitting candidate. | Restore the saved enclosure configuration and rule, distinguish saved selection from a recalculated proposal, and export the intended selection. |
| ENCL-009 | Export checks dimensions but does not enforce complete counting, catalogue validation or a fitting candidate. | Block invalid exports or label them clearly as incomplete/failed investigations. Apply consistent validation to saving and exports. |
| ENCL-010 | A flush candidate can be marked Fits when only surface dimensions exist. | Exclude unsupported mounting or flag it explicitly; do not save a mounting without valid dimensions. Executed reproduction confirmed this. |
| ENCL-011 | Excel export/import drops overlapping-rule metadata; supplier-confirmation cases can become Fits. | Preserve overlap definitions or reliably reconstruct them. A round trip must preserve the same decision and warnings. Executed reproduction confirmed this for the fabricated catalogue; relevant only if that catalogue is used for a DB. |
| ENCL-012 | A saved enclosure is not explicitly rechecked when its equipment changes. | Preserve the saved selection, but show that its adequacy needs review and provide a comparison with current equipment requirements. |
| ENCL-013 | Negative usable capacity is only a warning; JSON imports have limited schema validation. | Reject impossible numerical data and validate imported catalogue/device schemas before use. Negative-capacity validation was reproduced; malformed-file handling requires broader testing. |
| ENCL-014 | Fabricated allowance selection can bypass current-dependent overlap checks when incomer current is absent. | Require the missing current before resolving the applicable case. Executed reproduction: 14 ELCBs with no incomer current. Relevant only if that catalogue is used for a DB. |

## Supplier questions — not calculation bugs

- The modular chart has blank usable-capacity cells for smaller sizes. Current code conservatively treats them as not offered; obtain confirmation before adding capacities.
- The modular chart has no allowance case above 15 ELCBs. Show unsupported clearly; do not extrapolate a supplier rule.
- Confirm device widths, physical poles, incomer arrangement, accessory space and enclosure applicability for the chosen product range.

## Suggested correction batches

1. **Counting and reconciliation:** ENCL-001, ENCL-002; retest the same DB schedule matrix.
2. **Product mapping and manual inventory:** ENCL-003, ENCL-004, ENCL-005, ENCL-006.
3. **Saved-state, export and library reliability:** ENCL-007 through ENCL-014.

No issue is marked fixed until implementation and a dated successful retest are recorded.
