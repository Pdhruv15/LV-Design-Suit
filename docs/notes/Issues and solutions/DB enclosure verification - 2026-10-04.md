---
created: 2026-10-04
status: verification-completed-with-failures
tags: [enclosure, db, test-evidence]
---

# DB enclosure verification - 2026-10-04

Issues: [[DB enclosure issues and solutions]] · Index: [[Issues and solutions]]

Tested local checkout on 4 October 2026. Review only; application files unchanged. MDB/SMDB/LVMDB enclosure calculations excluded.

## Assumptions

Synthetic three-phase DB schedules; one 1-module MCB per single-phase circuit, one 4-module RCCB per multiphase ELCB group, 4 modules for the incoming device and 8 spare modules. These are explicit test-fixture widths, not universal manufacturer dimensions. Parent supply board is only fixture context.

## Results

```json
{
  "manualPass": 338,
  "manualFail": 0,
  "schedulePass": 0,
  "scheduleFail": 28,
  "unassignedCircuit": {
    "physical": 7,
    "counted": 6
  },
  "existingSchedule": {
    "circuits": 21,
    "elcb": 4,
    "expected": 41,
    "actual": 33,
    "unmapped": 0
  }
}
```

## Manual versus schedule matrix

| Circuits | Circuits/group | ELCBs | Expected equipment modules | Actual equipment modules | Manual selection (+8 spare) | Schedule selection (+8 spare) | Result |
|---:|---:|---:|---:|---:|---|---|---|
| 3 | 3 | 1 | 11 | 9 | 5 × 16 | 5 × 16 | FAIL |
| 6 | 3 | 2 | 18 | 14 | 5 × 16 | 5 × 16 | FAIL |
| 12 | 3 | 4 | 32 | 24 | 5 × 16 | 5 × 16 | FAIL |
| 18 | 3 | 6 | 46 | 34 | 5 × 16 | 5 × 16 | FAIL |
| 24 | 3 | 8 | 60 | 44 | 5 × 16 | 5 × 16 | FAIL |
| 30 | 3 | 10 | 74 | 54 | 6 × 16 | 5 × 16 | FAIL |
| 36 | 3 | 12 | 88 | 64 | 5 × 24 | 5 × 16 | FAIL |
| 39 | 3 | 13 | 95 | 69 | 5 × 24 | 6 × 16 | FAIL |
| 42 | 3 | 14 | 102 | 74 | 6 × 24 | 6 × 16 | FAIL |
| 45 | 3 | 15 | 109 | 79 | 6 × 24 | 5 × 24 | FAIL |
| 46 | 3 | 16 | 114 | 82 | Unsupported ELCB count | Unsupported ELCB count | FAIL |
| 48 | 3 | 16 | 116 | 84 | Unsupported ELCB count | Unsupported ELCB count | FAIL |
| 60 | 3 | 20 | 144 | 104 | Unsupported ELCB count | Unsupported ELCB count | FAIL |
| 72 | 3 | 24 | 172 | 124 | Unsupported ELCB count | Unsupported ELCB count | FAIL |
| 3 | 6 | 1 | 11 | 9 | 5 × 16 | 5 × 16 | FAIL |
| 6 | 6 | 1 | 14 | 12 | 5 × 16 | 5 × 16 | FAIL |
| 12 | 6 | 2 | 24 | 20 | 5 × 16 | 5 × 16 | FAIL |
| 18 | 6 | 3 | 34 | 28 | 5 × 16 | 5 × 16 | FAIL |
| 24 | 6 | 4 | 44 | 36 | 5 × 16 | 5 × 16 | FAIL |
| 30 | 6 | 5 | 54 | 44 | 5 × 16 | 5 × 16 | FAIL |
| 36 | 6 | 6 | 64 | 52 | 5 × 16 | 5 × 16 | FAIL |
| 39 | 6 | 7 | 71 | 57 | 6 × 16 | 5 × 16 | FAIL |
| 42 | 6 | 7 | 74 | 60 | 6 × 16 | 5 × 16 | FAIL |
| 45 | 6 | 8 | 81 | 65 | 5 × 24 | 6 × 16 | FAIL |
| 46 | 6 | 8 | 82 | 66 | 5 × 24 | 6 × 16 | FAIL |
| 48 | 6 | 8 | 84 | 68 | 5 × 24 | 6 × 16 | FAIL |
| 60 | 6 | 10 | 104 | 84 | 5 × 24 | 5 × 24 | FAIL |
| 72 | 6 | 12 | 124 | 100 | 6 × 24 | 5 × 24 | FAIL |

## Findings

1. Multiphase ELCB groups made of single-phase circuits are counted as 2-pole RCCBs, undercounting space by 2 modules per group with these fixture widths.
2. When scheduled circuits exist, an additional circuit without phase/way is silently omitted rather than flagged incomplete.
3. Manual capacity comparisons match an independent transcription of the currently offered supplier-chart capacities, but do not establish physical layout or thermal suitability.
4. Current manual mode accepts total module counts, not a circuit/device quantity breakdown.
5. Existing interface still has earlier panel-switching, saved-selection restoration and export-validation limitations. These were code-reviewed, not browser-tested in this run.
6. Existing panel and DB fixtures use supplied test widths; no actual installed user library or private project file was read.
7. Local code retains the previous RCCB counting logic; any update in another branch or folder remains unverified.

## Additional control cases

16/16 passed for no ELCB, individual RCBO (fixture with poles=1), same-phase groups and three-phase circuit groups. This demonstrates the defect is specifically triggered by groups spanning phases through single-phase circuits.

| Mode | Circuits | ELCBs | Manual modules | App modules | Result |
|---|---:|---:|---:|---:|---|
| no-elcb | 1 | 0 | 5 | 5 | PASS |
| no-elcb | 6 | 0 | 10 | 10 | PASS |
| no-elcb | 12 | 0 | 16 | 16 | PASS |
| no-elcb | 24 | 0 | 28 | 28 | PASS |
| individual-rcbo | 1 | 0 | 6 | 6 | PASS |
| individual-rcbo | 6 | 0 | 16 | 16 | PASS |
| individual-rcbo | 12 | 0 | 28 | 28 | PASS |
| individual-rcbo | 24 | 0 | 52 | 52 | PASS |
| same-phase-group | 1 | 1 | 7 | 7 | PASS |
| same-phase-group | 6 | 3 | 16 | 16 | PASS |
| same-phase-group | 12 | 6 | 28 | 28 | PASS |
| same-phase-group | 24 | 12 | 52 | 52 | PASS |
| three-phase-circuit-group | 1 | 1 | 11 | 11 | PASS |
| three-phase-circuit-group | 6 | 3 | 34 | 34 | PASS |
| three-phase-circuit-group | 12 | 6 | 64 | 64 | PASS |
| three-phase-circuit-group | 24 | 12 | 124 | 124 | PASS |

Additional limitations: a physical 2-pole (1P+N) RCBO dimension record cannot match the automatically requested poles=1; fractional ELCB count 1.5 is accepted in manual sizing.
