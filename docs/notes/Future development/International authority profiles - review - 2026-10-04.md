---
created: 2026-10-04
status: on-hold-awaiting-user-confirmation
tags: [international, authority-profiles, engineering-review]
---

# International authority profiles - review - 2026-10-04

Index: [[Future development]] · Current scope: [[Status]]

## User decision — 2026-10-04

International support is a future-development idea and is **on hold until the user explicitly confirms proceeding**. The current development priority is **Dubai / DEWA**: engineering calculations, load schedules, SLDs and authority submission quality.

Do not start international profile infrastructure, India support, other-country templates or additional authority rollout from this proposal. Continue the authorised DEWA work. The analysis and references below are retained for a later decision; they are not an active implementation plan.

Read-only review of application code after the contractor BOQ work. No application code was changed for this investigation. The findings below are source-reviewed limitations, not new failing numerical test results.

## Future recommendation — on hold

Keep the current app interface and shared electrical calculation engine. Add locally stored, versioned authority packs selected by country → state/emirate → utility/inspectorate → project/application type. Separate engineering rules from document presentation. Start with Dubai/DEWA and one explicitly chosen Indian state/utility rather than claiming complete UAE/India coverage.

## Source-reviewed limitations and proposed corrections

| ID | Status | Existing limitation | Proposed correction |
|---|---|---|---|
| INT-001 | Proposed | Project has no country/authority/standards-edition identity. Database cable/rule/catalogue data are global and mutable; Project snapshot alone does not capture the effective engineering dataset. | Save the resolved authority profile, rule editions and relevant cable/equipment data versions or immutable content with each project. Include them in calculation/export snapshots. Changing profile requires a comparison and explicit recalculation. |
| INT-002 | Proposed | Point types include DEWA-specific 13 A/15 A socket identities. Default SLD notes contain literal TN-S, 50 Hz, 4% and 100/30 mA assumptions. | Use neutral equipment identities with actual ratings and circuit purpose. Map these to regional columns. Render notes from resolved project data and reviewed rules. Relabelling a socket column must not change its technical identity. |
| INT-003 | Proposed | Earth-fault disconnection checks model TN within a specified voltage band; TT is explicitly unmodelled. | Store the actual project earthing system. Implement and independently validate each additional supported model. Show unsupported checks explicitly; a country selection must not imply that all systems are supported. |
| INT-004 | Proposed | Cable reference data use CSA-based selection with limited construction/material/method assumptions. | Select datasets by conductor material, cable construction, installation method, ambient/soil conditions and source/manufacturer. Verify ampacity, correction factors, voltage drop and CPC calculations against independent cases. |
| INT-005 | Proposed | Current authority forms and issue checks are mainly DEWA-oriented; required submission documents vary with authority and application stage. | Version separate DB/SMDB/MDB/load-summary templates, SLD conventions and required-document checklists. Allow externally prepared layouts/reports in the issue package. Verify accepted file types for the actual submission channel. |

Relevant source: `src/types.ts`, `src/calc/earthing.ts`, `src/calc/cableTable.ts`, `src/calc/loadSchedule.ts`, `src/docs/sldNotes.ts`, `src/docs/dbSheet.ts`, `src/docs/mdSheet.ts`, `src/model/titleBlock.ts`, `src/database/database.ts`, `src/docs/issuePackage.ts`.

## Authority pack contents

- Identity: country, region, utility/inspectorate, application type and supported project scope.
- Engineering basis: standard/edition, source clause/page, applicable rule, effective date and verification status.
- System basis: actual line/phase voltage, frequency, earthing arrangement, environment and source/fault information.
- Demand policy: connected load, diversity application level, maximum demand and contractual limits; avoid applying diversity twice.
- Protection/cabling: supported disconnection checks, RCD criteria, device datasets, cable methods/factors and voltage-drop budgets.
- Documents: column mapping, grouping/rounding/totals, header fields, SLD symbols/annotations/notes, title block and revision conventions.
- Submission: stage-specific checklist, externally supplied documents and confirmed accepted output formats.

Authority packs should be editable as local data/templates. Reviewed rule packs remain distinct from user custom packs. Projects retain the pack version and explicitly recorded overrides that were used to design them.

## UAE and India pilot

- Dubai/DEWA: preserve existing output as a regression reference, verify against applicable published regulations/circulars and representative accepted projects. Separate DEWA support from other emirates' authority profiles.
- India: use applicable CEA and BIS requirements plus one state's utility/inspectorate requirements. Tamil Nadu can be a pilot if that is the intended market. Define the initial scope as supported LV design; retain flags/attachments for HT or specialist studies outside the current model.
- Keep UI additions inside Project settings and existing report/drawing template controls. Preview and checklist should show the resolved authority, version, assumptions and outstanding checks.

## Deferred sequence and acceptance — after user confirmation

1. Establish project-frozen engineering profiles and separate document templates; preserve existing DEWA projects and outputs.
2. Add one Indian LV pilot with specific utility/inspectorate and project applicability, new equipment categories and required form mapping.
3. Validate villa/small commercial and multi-panel examples independently: currents, demand, phase totals, cables, protection, earthing and complete exports.
4. Check missing/unsupported data, profile-switch effects and project reopening after library updates. Obtain local engineer review of the submission pack before describing the profile as verified.

## Verified primary references

- [DEWA electricity permits/connections requirements](https://www.dewa.gov.ae/en/about-us/service-guide/builder-services/getting-electricity-connections): board/load summaries, SLD and supporting layouts. Its required-document list names DWF for the SLD while the FAQ lists PDF/XLSX attachments; confirm the applicable portal/channel before fixing format rules.
- [DEWA circulars](https://www.dewa.gov.ae/en/builder/useful-tools/dewa-circulars) and [2026 service enhancement circular](https://www.dewa.gov.ae/-/media/Files/Enhancement-in-Getting-Electricity-Connection-Services.ashx): submission processes change independently of the engineering equations.
- [CEA safety regulations index](https://cea.nic.in/regulations-category/measures-relating-to-safety-and-electric-supply/?lang=en): contains the 2023 regulations and 2026 amendment. A pack must track applicability/effective dates rather than selecting a rule solely from its title year.
- [BIS official standards listing](https://www.bis.gov.in/wp-content/uploads/2023/11/Book-07-Health-_-Family-Welfare.pdf): lists India's NEC SP 30:2023 and wiring code IS 732:2019; full applicable provisions require authorised standard access and engineering review.
- [Tamil Nadu Electrical Inspectorate drawing-approval procedure](https://tnswp.com/DIGIGOV/StaticAttachment?AttachmentFileName=/procedure/pre_est/PE_13.pdf): complete SLD, equipment/protection/laying/earthing details and supporting layouts. Its HT/EHV-specific items are conditional, not universal LV requirements.
