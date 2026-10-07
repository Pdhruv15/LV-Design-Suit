---
created: 2026-10-04
status: implemented-and-verified-on-branch
tags: [boq, contractor-scope, test-evidence]
---

# BOQ implementation and retest - 2026-10-04

Index: [[Issues and solutions]] · Findings: [[BOQ contractor scope issues and solutions]]
Historical review: [[BOQ verification - 2026-10-04]]

## Tested checkout

Base `210b677`, branch `codex/boq-contractor-scope`, verified implementation commit `4038f3b`. Review: [PR #123](https://github.com/Pdhruv15/LV-Design-Suit/pull/123). This note verifies the local source and branch preview. The installed desktop package has not been updated; the project workflow is PR review, user-authorised merge, then `npm run update-app`.

The existing ribbon, page cards, colours, icon/control sizes and BOQ table columns are preserved. Scope & review is an additional page inside BOM / Cost. Item editors use tab/card pages according to Working rules.

## Verified corrections

| Issue | Retest result | Status |
|---|---|---|
| BOQ-001 | The sample 21-circuit DB produces four grouped RCCB/ELCB devices. Covered schedule circuits do not also add the same per-feeder RCD. Independent feeder RCDs remain. | Verified fixed for tested grouped arrangements |
| BOQ-002 | Opt-in point takeoff uses physical schedule counts; selected products and custom spare names stay distinct. Plant equipment defaults to client supply with contractor installation. Missing phase/way/board information warns per omitted circuit. | Partially implemented; detailed room/product schedules still required |
| BOQ-003 | A 10 m two-conductor circuit produces 20 m L/N and 10 m CPC. Parallel and three-phase cases are tested; rounding happens after aggregation. New conductor keys do not reuse old route-metre prices. | Verified fixed for conductor quantities; conduit still measured separately |
| BOQ-004 | Cu/Al, manufacturer/model, saved enclosure catalogue/configuration, mounting, frozen dimensions and revision distinguish panel items. Identical specifications still aggregate. Surface H905×W445×D115 and flush H925×W465×D115 each produce quantity 1. | Verified fixed for these recorded specification fields |
| BOQ-005 | Authority incomer uses supply rating and meter independently of busbar rating. Explicit isolators and selected ACB/MCCB devices appear correctly. Conflicting engineering breaker type is disclosed without changing the input. | Verified fixed for tested device inputs |
| BOQ-006 | Fit-out / new-installation templates select review prompts. New, retain, relocate, remove and replace actions are available per line. Templates do not create quantities. | Verified implemented |
| BOQ-007 | Client-supplied quantity 2 at installation rate 25 gives 50; supply is not charged. Retain gives 0; remove/relocate charge installation only. Explicit zero differs from a missing rate. | Verified implemented |
| BOQ-008 | Additional point/device/conduit/box/ELV extras are available for measured entry. Physical measured extras start at zero. | Partial; no inferred conduit routes or complete fitting assemblies |
| BOQ-009 | Complete positive-priced compatible packages suppress linked components once. Dangling/cyclic links, installation-only parents hiding material charges and incompatible actions warn and keep components priced. | Verified implemented for entire-line inclusion |
| BOQ-010 | Mechanical connection/control and optional plant/ELV extras and responsibility choices are available. | Partial; full generator/UPS/PV/EV balance-of-system takeoff needs explicit data |
| BOQ-011 | Existing-work, site-condition and civil scope prompts, measured extras and exclusions are available. | Partial; survey quantities and contract decisions remain manual |
| BOQ-012 | Review identifies unreviewed scope, missing quantities/rates, changed overrides, package conflicts and quotation migration. Excel/PDF carry source, responsibility and scope decisions. | Partial; formal estimator approval and tender-readiness workflow remain outside this change |

## Regression and export checks

- `npm test -- --reporter=dot`: **741 tests passed in 106 files**.
- `npm run build`: passed, including TypeScript compilation. Existing Vite large-bundle/mixed-import warnings remain.
- `git diff --check`: passed.
- Browser preview: existing BOQ navigation/table, scope page, opt-in points, client-supplied installation and retain/remove edits exercised. Temporary verification item deleted afterwards.
- Independent final audit reproduced separate surface/flush lines and correct selected ACB/MCCB identity; **62 takeoff/scope tests passed**.
- Excel tests cover blank supply, installation-only rates, explicit zero, package/retained rows, formula integrity, escaping and complete checklist decisions. Legacy projects retain their established worksheets.
- Electron PDF fixture: summary fits **one A4 page**; full BOQ plus scope appendix is **nine A4 pages**. Every page visually inspected: repeated table headers, readable figures, no overlapping/clipped rows. Full appendix contains all outstanding checks; summary lists compact warning counts.

![[Assets/boq-scope-verified-2026-10-04.jpg]]

![[Assets/boq-client-install-verification-2026-10-04.jpg]]

## Saved-project and pricing review

Changed panel and conductor identities intentionally require quote review. Orphan quantity/scope/exclusion overrides show their exact saved keys. Old panel quotes and old `wire:*` route-metre quotes are not transferred automatically. Review and explicitly transfer applicable settings to the correctly specified current lines.

Partial/unquoted totals retain known charges and are labelled incomplete. A scope decision is not proof that quantities are measured. Package links cover the whole aggregated BOQ line; partial/location-specific coverage should use separate measured manual lines.

Design revision comparisons cover design quantities at current rates. Manual scope, responsibility changes and package changes are not compared; exports disclose this limit.

The app still requires measured layouts/site information, contract scope and supplier quotations for a complete contractor bill.
