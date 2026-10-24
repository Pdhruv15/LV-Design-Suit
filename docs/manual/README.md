# LV Design Studio manual source

This folder is the source of truth for the modular user manual. Published PDFs,
HTML, and in-app help should be generated from these modules rather than edited
independently.

## Files

- `manual-index.yml` controls chapter order and publication status.
- `component-map.yml` maps app routes and source files to affected modules.
- `modules/<stable-id>-<slug>/module.yml` records module metadata and stable sections.
- `modules/<stable-id>-<slug>/content.md` contains the user-facing instructions.
- `visuals.json` declares each deterministic app capture and its numbered reference points.
- `assets/<module-id>/` contains generated screenshots and callout coordinates.

## Stable numbering

Module IDs never change. Displayed chapter numbers come from the order in
`manual-index.yml`.

Section IDs use increments of ten. For example, a feature inserted between
`LS-040` and `LS-050` receives `LS-045`; existing IDs and cross-references do not
change.

## Updating the manual with a feature

1. Check `component-map.yml` for the affected module.
2. Update the existing section or allocate an unused section ID between its neighbours.
3. Add a new module only when the feature introduces a distinct user workflow.
4. Update instructions, checks, troubleshooting, and visual references together.
5. Update the module version, app version, and `last_reviewed` date.
6. Record the change in the manual changelog when the module is approved.

If a changed component has no user-visible effect, the pull request should record
the reason that no manual update is required.

## Refreshing app images and PDFs

Run `npm run manual:setup` once on a documentation workstation, then run
`npm run manual:update`. It builds the app, opens only the committed
demonstration project in a hidden offline window, captures the declared views,
updates callout coordinates, rebuilds both visual PDFs, and checks the manual
structure. Review the changed images and PDFs before a stable release.

The `data-doc-id` attributes used by `visuals.json` are invisible anchors. Keep an
anchor with the control it describes when refactoring. Add a new shot or callout
to the manifest instead of editing an image by hand.

