# Revision comparison and reference integrity (Phase 2, D1)

Added 5 October 2026.

## What "changed since the revision" now means

Every persisted field of the project, each board and each circuit is classified in
`src/model/changeClass.ts` as **engineering**, **drawing**, **commercial**, **admin** or
**bookkeeping**. The three tables are typed as complete records, so adding a field to
`Project`, `Board` or `Feeder` without classifying it fails the type check; a test also
checks that every classified field has a comparison line.

| Class | Examples | Counts as "design changed"? |
| --- | --- | --- |
| Engineering | loads, cables, breakers, ratings, UPS, earthing plan, PV, trays, building, studies settings, demand factor | yes |
| Drawing | panel and circuit names, rooms, remarks, sheets and markups, title block, parameters | yes |
| Commercial | BOQ lines, quantity changes, wastage, discounts, price list rates | no — flagged as commercial only |
| Admin | project name, status, owner/plot, tags, notes, scope and deliverables | no |
| Bookkeeping | ids, dates, schema version, who saved, earth pit IDs, auto-assigned cable numbers, sheet issue history | never shown |

`changedSinceRevision` (used by the Overview readiness) counts engineering and drawing
changes only. Revisions → Compare shows a filter per class, a class column in the CSV, and
says "the design itself is unchanged (only pricing or project details)" when that is so.

## What is compared now

UPS and battery systems (capacity, backup time, state of charge window, BMS limit, charger and
recharge, manufacturer power table, starting surge), the earthing plan (pits per equipment,
links, measured values, electrode and conductor), drawing sheets (one item each: paper, notes,
markups, panels, numbers; the set options; the title block), BOQ and price list, space plan,
power factor and containment calculators, own components, parameters, study report setup, and
the circuit and panel fields that were missing (manual sizing flag, local isolator, capacitor
steps, detuning, component values; busbar material, IP rating, manufacturer, model, RMU,
surge protection, enclosure, substation, transformer reference and others).

Differences are listed as before → after with units; deeply nested data is matched by id and
shows only the changed fields. The earthing plan is compared after the same normalisation the
app applies on opening, so a revision issued before pit IDs existed does not look edited.

## Reference integrity

`src/model/integrity.ts` `checkReferences` verifies every cross-reference: panel feeds and
incomers, loops, duplicate ids, sheets, revision clouds, callouts, UPS links, bus couplers,
risers, study report scope, plans and selections. Tests run it after rename, move, copy and delete.
The audit found and fixed two real gaps:
- Deleting a panel left it on sheets, in clouds and callouts, UPS links, couplers, risers,
  report scopes, plans and selections (now removed by `removeDanglingReferences`).
- Renaming a panel did not update the voltage-drop selection, nor the earthing keys that embed
  the panel id, which orphaned its pit settings, pit IDs and measured values (now followed).

## Not covered yet

- Nested objects inside one panel or circuit field (`supply`, `enclosure`, `standby`) are shown
  as one line, not per sub-field.
- BOQ design quantities are not compared here (D3: quantity comparison independent of rates).
- Equipment identity is still the editable id; replacing it is a separate migration and is not
  part of this phase. The integrity checker is the safety net meanwhile.
- BOQ override keys are derived from the bill of materials and are not reference-checked.

# Design baseline and working draft (Phase 2, D2)

- **Baseline** (`Project.baseline`, `src/model/designBaseline.ts`): points at an issued revision. The
  frozen copy stays in that revision, so editing the working draft never changes it, and choosing a
  different baseline changes only the pointer — the design, BOQ and every adjustment stay as they are.
  Until one is chosen the latest issued revision is the baseline; a pointer to a revision that is gone
  falls back to the latest. The pointer is bookkeeping: choosing it is not itself a change in comparisons.
- **Where:** Revisions → "Use as baseline" per revision (Compare then starts from it), a banner on the
  Revisions page, and a bar on the Design workspace: "Baseline: Rev A · Working draft: 3 engineering ·
  1 drawing · 2 commercial changes" with Compare with baseline. Pricing is listed apart from
  engineering. For a contractor project (brief role) engineering edits are flagged as differing from
  the received design.
- **Restore revision** now restores the design but keeps what belongs to the project: name, status,
  tags, notes, scope, baseline, identity, dates and bookkeeping (it used to revert all of them, so
  restoring Rev A could turn an approved job back into "design"). The demand factor and built-up
  area in the form details are engineering inputs and are restored.
- **Not in D2:** registering a received document set as an external reference baseline (it belongs
  with the received-document register, Batch C), a read-only "View baseline", and "Start
  modification" (arrives with D3 modification records). Workflow presets reuse the project role
  from the new-project wizard instead of adding another setting.
