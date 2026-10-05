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

# Impact preview (Phase 2, D3 step a)

`src/model/designImpact.ts` `impactBetween(before, after)` answers "what does this change touch?" from
the model alone, and never states a result. It is used for the working draft against its baseline
(Revisions → **Changes**, or "Impact…" on the Design workspace bar) and is the same function the
modification records will use to preview a proposal before it is applied.

- **Panels:** those that changed, those that feed them (their demand and voltage drop: "upstream"),
  and those they feed ("downstream", for incomer and panel changes), with the before/after maximum
  demand added up from the loads (not a study result).
- **Studies to run again:** decided by the same input fingerprints that mark results out of date
  (`src/calc/runs.ts`), plus UPS (data changed, or fed from a panel whose load changed), solar and
  the earthing plan. Only engineering changes reach studies and UPS: renaming a panel does not.
- **Drawings and schedules:** sheets that show an affected panel, the earthing and riser sheets when
  relevant, and the load, DB, cable and cable-tray schedules by which fields changed.
- **BOQ design quantities:** from the design model only (no rates, manual lines, overrides or
  wastage), so no cost is shown.
- **Not determined here:** listed explicitly (no new results; UPS runtime and battery size; earth
  pit measurements; design vs site-measured cable lengths).

Pricing, project details and bookkeeping are not design impact.

# Modification records and applying them (Phase 2, D3 steps b and c)

`src/model/designChanges.ts`, shown under Reports → **Changes → Modifications**.

- **Record:** id (MOD-001), title, reason, origin (comment / query reference), author, date, the baseline
  revision it was made against, status, history, and the proposed changes: each names a circuit, panel,
  UPS or project setting and field, with the value it replaces (**before**, captured when proposed) and the
  new value (**after**). Supported fields are listed in `PROPOSABLE` (loads, cable, breaker, ratings,
  transformer data, UPS and battery inputs, voltage, frequency, ambient, voltage-drop limit …). Added or
  removed equipment is not a field change and cannot be proposed this way yet.
- **Statuses:** Draft → Proposed → Under review → Accepted / Rejected, or Superseded (say what replaces
  it). A draft is the only editable state; a proposal needs a title, a reason and at least one change.
  Accepting or rejecting records a decision (who, when, note). Accepted and rejected are final.
- **Applying is separate from accepting.** Apply changes the working design as one transaction — all of
  it or none, record and design updated together so **one undo** reverses both — and is allowed only for an
  accepted, not yet applied record. A draft, proposed, under-review, rejected or superseded record never
  changes the design.
- **Edits made since the proposal are never overwritten silently.** Where a value is no longer what the
  proposal was made against, apply stops and lists it; you can reconcile (re-base the proposal on the
  current values, recorded in its history), apply the rest and keep the later edits, or overwrite them on
  purpose (recorded). A deleted item is skipped. Accepting an old proposal that no longer matches needs
  reconciling first.
- **Preview:** the same impact function as the draft preview (panels, studies to run again, drawings and
  schedules, BOQ design quantities, what is not determined), computed on a copy.
- **Record the draft's changes:** turns field edits already made in the working draft into a record, with the
  baseline's values as "before", marked as recorded rather than applied. Differences that are not field edits
  are counted and reported, not guessed.
- Names are typed text (the profile name). The app has no accounts and records no verified identity.
- Records are administration (not a design change); applying one changes the design, and so is a change
  against the issued revision. Not yet: adding or removing equipment as a proposal, per-record
  attachments, and reviewer comments (D5).
