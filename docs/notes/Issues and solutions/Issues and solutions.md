---
updated: 2026-10-04
tags: [engineering-review, issues]
---

# Issues and solutions

Record investigation findings, proposed solutions and retest evidence here. Keep this folder separate from the module map and future-development notes.

## Current investigations

| Module | Issue record | Test evidence | Status |
|---|---|---|---|
| DB enclosure sizing | [[DB enclosure issues and solutions]] | [[DB enclosure verification - 2026-10-04]] | Open — corrections not verified |
| Contractor BOQ | [[BOQ contractor scope issues and solutions]] | [[BOQ verification - 2026-10-04]] · [[BOQ implementation and retest - 2026-10-04]] | Implemented and retested on branch — contractor scope partially complete |
| DXF / CAD export | [[DXF export issues and solutions]] | [[DXF export verification - 2026-10-04]] | Verified fixed in automated/browser tests and LibreCAD sample; kept local |

## How to record future work

- Give each issue a stable ID, affected module, reproduction example and expected versus actual result.
- Record the tested checkout and scope. Do not assume an installed app or another branch matches the local source.
- Separate confirmed failures from code-review findings and supplier questions.
- Record proposed corrections under **Proposed solution**. This does not mean the correction has been implemented.
- Use **Fixed — awaiting retest** only after implementation, and **Verified fixed** only after a successful retest with recorded evidence.
- Preserve earlier test results; add a dated verification note when the code changes.

Useful statuses: Open · Proposed solution · Fixed — awaiting retest · Verified fixed · Needs supplier confirmation · Out of scope.

Project: [[LV Design Studio]] · Module: [[Enclosure sizing]]
