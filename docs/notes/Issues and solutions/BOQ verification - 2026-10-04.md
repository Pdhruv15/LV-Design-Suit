---
created: 2026-10-04
status: verification-completed-with-findings
tags: [boq, test-evidence]
---

# BOQ verification - 2026-10-04

Issues and proposed corrections: [[BOQ contractor scope issues and solutions]]
Index: [[Issues and solutions]]

## Tested scope

Local Git revision recorded during review: `210b677`. Other enclosure files were being edited concurrently; this review did not modify them.

Local full BOQ generation (`buildBom`) and existing BOQ tests. Review only; no application-code changes. The installed package and a live browser session were not exercised.

## Existing tests

`npm test -- src/calc/bom.test.ts`: **12 tests passed**.

The passing tests do not establish contractor-scope completeness. In particular, the existing length test accepts the current circuit-route measurement convention.

## Independently executed reproductions

| Case | Expected / required distinction | Actual | Result |
|---|---|---|---|
| Sample DB | 21 schedule circuits, four ELCB groups; groups must be represented or assigned to a panel package | Zero RCD/ELCB BOQ item types | Grouped protection omitted |
| Sample DB points | 100 schedule points across lighting, sockets and load equipment; map applicable points to physical products and ownership | No point-derived luminaire/socket/equipment lines | No schedule-point take-off |
| Final SP circuit, 10 m | For conductor procurement: 20 m of 2.5 mm² live/neutral + 10 m of 1.5 mm² CPC; shared conduit requires its own measurement. A complete route assembly can instead be measured as 10 route-metres if inclusions are declared. | One 10 m item labelled single-core wiring 2.5 mm² with two conductors + CPC; no separate CPC/conduit | Unit/assembly ambiguity |
| Two differently specified DBs | Copper and aluminium 100 A boards remain separate products | One panel item, quantity 2, described as copper busbar | Specification aggregation failure |

The 100 point total is not an instruction to purchase 100 electrical fixtures: the schedule contains different point categories and other-trade equipment. Product and scope mapping are needed.

## Other code-reviewed findings

- Authority-fed supply-only ratings/meters are not fully reconciled into root incomer generation.
- Actual switching-device identity can differ from the breaker-derived BOQ description.
- Complete-panel, lighting-point and installation packages have no structured component-inclusion relationship.
- Existing fit-out work has no structured retain/relocate/remove pricing action.

## Retest requirements

1. Grouped RCCBs and individual RCBO/RCD arrangements, including prevention of double counting.
2. Point quantities mapped to distinct product types and client/other-trade ownership.
3. Conductor metres versus route-metres under an explicit measurement basis; CPC and shared containment.
4. Panels differing in busbar material, model, enclosure, IP rating, voltage or package specification.
5. Client-supplied equipment with contractor installation costs preserved.
6. A complete panel supplied as one package versus separately priced shell/components.
7. Fit-out actions and new-installation scope selections without unconditional extra items.

This original review did not mark findings fixed. The subsequent implementation and dated retest are recorded in [[BOQ implementation and retest - 2026-10-04]].
