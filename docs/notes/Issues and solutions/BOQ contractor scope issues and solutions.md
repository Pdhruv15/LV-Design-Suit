---
created: 2026-10-04
updated: 2026-10-04
status: partially-implemented-and-retested
tags: [boq, contractor-scope, fit-out, new-installation]
---

# BOQ contractor scope issues and solutions

Index: [[Issues and solutions]] · Module: [[Reports]]
Evidence: [[BOQ verification - 2026-10-04]] · Retest: [[BOQ implementation and retest - 2026-10-04]]
Visual: [[Contractor BOQ concept - 2026-10-04]]

## Conclusion

The current full BOQ is a useful design-derived materials and pricing tool with manual completion. It reads shared project boards/feeders and route data, rather than measuring quantities from the SLD drawing geometry. It does not yet automatically produce a complete electrical contractor scope.

Use **one BOQ engine with two scope templates**, fit-out/alteration and new installation. Choose applicable systems within each template. A new installation does not automatically include a transformer, generator, PV or ELV system; contract scope governs.

## Already available — preserve and extend

- Automatic design sections: panels and saved enclosure information; incomers/outgoing breakers, individual feeder earth-leakage devices, SPD, relays and local isolators; modelled metering/instruments; selected transformer/generator/ATS/UPS/PFC equipment; cables and accessories; busway; tray fittings/supports/covers; earthing.
- Manual items and custom sections, quantity/description overrides and "by others" exclusions.
- Separate supply and installation rates, reusable price lists and Excel rate import.
- Wastage, markup/discount, design-revision quantity comparison and Excel/PDF exports.
- One-click manual extras for testing/certificates, authority applications, as-builts, O&M manuals, training, cable pulling, access equipment, drilling/fire stopping, excavation, duct banks and provisional allowances.

At the original review, extras started with quantity 1. In the updated branch, measured count/metre extras start at zero; lump-sum extras remain at one. They require scope confirmation, measurement and pricing. They are not proof that the entire installation scope has been measured.

The separate per-circuit tab is a cable-and-breaker estimate with illustrative rates. It is not equivalent to the full contractor BOQ.

## Original confirmed quantity issues

These are the pre-change findings. Current verification status is in [[BOQ implementation and retest - 2026-10-04]].

| ID | Original status / priority | Finding and evidence | Proposed solution / acceptance |
|---|---|---|---|
| BOQ-001 | Open / High | The sample DB has 21 circuits and four calculated ELCB groups; the full BOQ emits zero RCD/ELCB lines. Only individual feeder `rcdMa` is counted. | Use the schedule's actual grouped devices, reconcile individual RCBO/RCD arrangements, and avoid duplication. The four group devices must appear when they are separate contractor-supplied items, or be explicitly included in a complete-panel package. |
| BOQ-002 | Open / High | The sample DB has 100 load-schedule points, but no point-derived luminaire/socket/equipment lines are generated. | Map each point to a product/work item, physical quantity, room/circuit and responsibility. Do not infer fixture quantities from circuit kW. Some load-side equipment may belong to another trade. |
| BOQ-003 | Open / High | A 10 m final circuit produces 10 m labelled "single-core wiring ... 2 conductors + CPC", with no separate CPC or conduit. | Declare the measurement basis. Conductor procurement requires 20 m live/neutral plus 10 m CPC for the tested two-conductor case before allowances; a circuit-route assembly rate may instead use 10 route-metres if its inclusions are explicit. Separate shared conduit measurement from conductor quantities. |
| BOQ-004 | Open / High | Two 100 A DBs, one copper and one aluminium, aggregate as quantity 2 under the copper description. | Include material and other price/specification-defining attributes in item identity. Different panel packages must remain distinct. |

Sources: `src/calc/bom.ts`, `src/calc/loadSchedule.ts`. Executed reproductions and limitations are recorded in [[BOQ verification - 2026-10-04]].

## Original further source-code findings

| ID | Original status | Finding | Proposed solution |
|---|---|---|---|
| BOQ-005 | Open | Main incomer generation does not consistently use supply-only rating/device/meter data; feeder switch-device identity is not represented by the breaker-only item function. | Reconcile supply settings, board ratings and actual switching-device records; test authority-fed boards and explicit isolators. |
| BOQ-006 | Proposed solution | No fit-out/new-installation scope template or structured existing-work action is present. | Add job type and per-asset New / Retain / Reuse / Relocate / Remove / Replace actions while keeping existing assets in the electrical model. |
| BOQ-007 | Proposed solution | A "by others" flag excludes the whole priced line, without separate supply and installation responsibility fields. | Distinguish contractor supply, client supply and other-trade supply from who installs, connects and tests. Preserve installation cost for client-supplied equipment when applicable. A manual line is a workaround today. |
| BOQ-008 | Proposed solution | Complete fittings, point assemblies and some optional systems are not generated from structured take-off data. | Add product/point schedules and route/detail take-off for devices, conduit/trunking, boxes, control wiring and selected systems. |
| BOQ-009 | Proposed solution | No explicit inclusion/package relation connects a complete assembly price with its generated component lines. | Add Included in package / Separately priced ownership so complete DB prices do not duplicate internal switchgear and bundled point rates do not duplicate wiring/labour. |
| BOQ-010 | Proposed solution | Selected power-equipment lines do not resolve complete installation packages. | Where included, model motor starters/VFDs/controls, generator ancillary works, UPS battery/bypass/rack items and PV/EV balance-of-system details. Split contractor electrical connections from equipment supplied by other trades. |
| BOQ-011 | Proposed solution | Manual extras do not capture all site conditions and preliminaries as a structured scope. | Add survey, shutdowns, temporary supplies, access/occupied-area protection, supervision/mobilisation, making good and measured penetrations/civil works, selected according to contract. |
| BOQ-012 | Proposed solution | Export is not a declaration that all quantities, package inclusions, supplier quotations and exclusions have been reviewed. | Add a scope-completion review: required information, estimated quantities, typical/unpriced rates, inclusions/exclusions and package duplication. Keep exports marked draft until the estimator confirms completeness. |

## Contractor scope templates

| Scope group | Fit-out / alteration | New installation |
|---|---|---|
| Existing conditions | Survey/capacity check; retain, relocate or remove; tie-in points | Site and authority/interface scope; existing assets where applicable |
| Distribution | DB alterations/replacement, spare-way devices, submains, final connections | Main intake, MDB/SMDB/DB, feeders and risers included in contract |
| Lighting and power | Luminaires, emergency/exit lights, switches/sensors, sockets/spurs/boxes | Same systems grouped by building, floor and zone |
| Wiring/routes | Conduit/trunking, boxes, local supports and route alterations | Complete routes and containment, external/underground works if included |
| Plant connections | HVAC, pumps, heaters, kitchen/IT equipment connections and controls by scope | Same, plus source packages such as generator/UPS/PV/EV if included |
| Installation conditions | Shutdowns, temporary power, out-of-hours work, occupied-area protection and making good | Access equipment, penetrations/fire seals, trenches/ducts/draw pits, equipment bases if included |
| Optional systems | Fire alarm, data/CCTV/access control/BMS interfaces when included | Same; lightning protection/site lighting/renewables when included |
| Handover | Modified circuits and retained-system interfaces; updated labels/schedules/as-builts | Complete tests, commissioning, documentation and training |

AHU/FCU, pumps, heaters and IT racks in a load schedule do not automatically become equipment to supply under an electrical contract. Their electrical connections and controls may be the contractor's scope while equipment supply belongs to others.

## Information required for each BOQ line

- Item specification/product and location.
- Unit and declared measurement basis: conductor metres, route metres, points, sets, complete assemblies or measured work.
- Quantity source: SLD/model, load/point schedule, measured layout, site survey, manual input or explicit allowance.
- Work action: new, retained, reused, relocated, removed or replaced.
- Separate supply and installation responsibility.
- Included components/package ownership; supply and installation rates and quotation provenance.
- Review status: verified, estimated, needs information, excluded or provisional.

SLD + schedules + measured layouts + site/contract scope → quantity reconciliation → inclusion review → supply/installation pricing → contractor BOQ.

## Suggested first two batches

1. Correct quantity reliability: grouped ELCBs, point inventory mapping, wire units/CPC and specification aggregation.
2. Add fit-out/new-installation templates with existing-work actions, responsibility fields and package-inclusion checks.

The findings and proposed solutions above preserve the original review. Implementation now exists on `codex/boq-contractor-scope`; tested corrections and partial-scope limits are recorded in [[BOQ implementation and retest - 2026-10-04]]. The installed package has not been updated.

## Primary references

- [RICS NRM measurement guidance](https://www.rics.org/profession-standards/rics-standards-and-guidance/sector-standards/construction-standards/nrm): useful reference for an explicitly selected measurement basis; no claim that the current app complies with NRM.
- [CIBSE refurbishment guidance](https://www.cibse.org/knowledge-research/knowledge-portal/tm53-refurbishment-of-non-domestic-buildings/): existing-building services assessment and commissioning/handover context.

The proposed scope is a planning checklist. Contract documents, specifications and measured site/layout information govern the final bill.
