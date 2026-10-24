# LV Design Studio manual source

This folder is the source of truth for the modular user manual. Published PDFs,
HTML, and in-app help should be generated from these modules rather than edited
independently.

## Files

- `manual-index.yml` controls chapter order and publication status.
- `component-map.yml` maps app routes and source files to affected modules.
- `modules/<stable-id>-<slug>/module.yml` records module metadata and stable sections.
- `modules/<stable-id>-<slug>/content.md` contains the user-facing instructions.

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

