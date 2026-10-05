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

## Exact comparison, frozen history

- Values are compared exactly, never through their rounded text: a change in the fourth decimal (a
  UPS end voltage of 1.7501 → 1.7502) is a change, and is shown with enough decimals to read
  differently. Equal numbers, key order and harmless empty forms (missing, blank, empty list or
  object, zero counts inside a points map) are not changes; a real 0 is a value.
- Issued revisions are frozen. Renaming, moving, copying or deleting panels never touches a
  snapshot (renames used to rewrite the references inside it, leaving it inconsistent); tests
  assert every snapshot stays byte-identical and its references unchanged.

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
- Deleting a panel left it on sheets, in clouds and callouts, couplers and report scopes (now
  removed by `removeDanglingReferences`). That cleanup deliberately does **not** touch what a study
  is sized from or scoped to — a UPS's panel, a riser's source, the transformer, power-factor and
  voltage-drop selections: clearing those would silently turn the study into something else (a
  panel-fed UPS into a zero-load manual one, an "empty = all" list into all). They stay unresolved,
  `checkReferences` and the To do list report them, and a UPS whose panel is gone shows an explicit
  source issue (no rating, no battery, not valid) until it is reassigned or deliberately unlinked.
- Renaming a panel did not update the voltage-drop selection, nor the earthing keys that embed
  the panel id, which orphaned its pit settings, pit IDs and measured values (now followed).

## Not covered yet

- Nested objects inside one panel or circuit field (`supply`, `enclosure`, `standby`) are shown
  as one line, not per sub-field.
- BOQ design quantities are not compared here (D3: quantity comparison independent of rates).
- Equipment identity is still the editable id; replacing it is a separate migration and is not
  part of this phase. The integrity checker is the safety net meanwhile.
- BOQ override keys are derived from the bill of materials and are not reference-checked.
