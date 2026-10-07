# Claude brief — Directory structure enhancement

## Request

Review the current LV Design Studio repository and propose a practical directory structure enhancement. Include the earlier suggestions for calculation efficiency, larger panel networks, responsiveness, offline storage and report output quality.

This is a desktop-first electrical engineering application that also has an installable offline browser version. Projects must remain usable with local files and without a cloud service.

**First inspect and explain; do not change application code in your first response.** Give the owner a concrete first batch of two changes, with affected files, expected benefit, risk and verification steps. After the owner authorizes that batch, implement only those two items and stop for verification. Continue in small approved batches.

Use the latest repository state. The pasted directory listing may be older than the checkout. Preserve existing engineering corrections, local work and project-file compatibility.

## Main objective

Make responsibilities and dependencies easier to understand while preparing the app for larger projects and more consistent outputs. Directory moves alone do not improve execution speed. Distinguish organizational cleanup from changes that reduce calculation, rendering or storage work.

Keep the existing React/TypeScript, Vite and Electron foundation unless measurements establish a specific reason to change it. Do not begin with a full rewrite, monorepo, new database server or replacement UI framework.

## Current foundation to preserve

The existing separation into calculations, project model, diagrams, documents and engine adapters is useful. Preserve these strengths:

- Engineering calculations and colocated regression tests.
- Run/F5 calculation workflow, optional auto-run and stale-study tracking.
- Separate built-in and external calculation engines.
- Browser/desktop local-file workflows and recovery behavior.
- Existing export formats, engineering assumptions and explicit unverified/no-fit states.

Useful inspection entry points in the reviewed checkout:

- [App.tsx](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/App.tsx): navigation, state, calculation coordination and feature imports.
- [runs.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/runs.ts): calculation snapshots and stale fingerprints.
- [electrical.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/electrical.ts) and [summary.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/calc/summary.ts): feeder evaluation, network traversal and downstream totals.
- [projectStore.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/model/projectStore.ts): browser/desktop storage and recovery.
- [studyReport.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/docs/studyReport.ts): report scope, calculations and presentation.
- [files.ts](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/src/util/files.ts) and [main.cjs](/Users/palanisamigovindasamy/Projects/LV-Design-Suit/electron/main.cjs): export and desktop PDF paths.

These machine-specific links are inspection references. Resolve equivalent repository files if working on another machine.

## Suggested directory direction

Treat this as a proposal to validate, not a requirement to create every folder or move every file immediately:

```text
src/
  app/                       # App shell, navigation, project/run coordination
  calc/
    network/                 # Topology validation, indexes, shared run context
    studies/                 # Domain calculations, only grouped when useful
    results/                 # Snapshot contracts, validity and provenance
  features/
    sld/                     # SLD workspace and feature-specific UI
    studies/                 # Calculation-study screens
    drawings/                # Sheets, layouts and title-block UI
    reports/                 # Report selection, configuration and export UI
    projects/                # Project dashboard and project management UI
  docs/
    data/                    # Format-independent report models
    renderers/               # PDF/HTML, Word, Excel and DXF output adapters
    templates/               # Shared print styles, headers and title blocks
  diagram/                   # Reusable diagram geometry and symbols
  engines/                   # Built-in/external-engine adapters
  model/                     # Project entities, edits, history and migrations
  database/                  # Engineering catalogue access and versions
  platform/
    browser/                 # Browser storage, files and offline integration
    desktop/                 # Renderer-side Electron bridge adapters
  shared/
    ui/                      # Reusable controls without engineering logic
    utilities/               # Small cross-feature utilities

electron/                    # Electron main/preload and native services
engines/python/              # External Python engine implementation
tests/
  fixtures/                  # Reusable realistic project fixtures
  performance/               # Scale, rendering and export benchmarks
  output/                    # Integration/rendered-output verification
docs/                        # Human-facing reviews, plans and design notes
```

Keep unit tests next to their modules. The root `docs` folder and `src/docs` have different purposes; document the distinction, or propose a clearer export-folder name if it helps. Avoid creating empty layers or duplicate ownership.

Explain where each existing module belongs and which moves can wait. Preserve import compatibility through small migrations rather than relocating the entire tree at once. Use file history-preserving moves where supported and update imports/tests in the same batch.

## Dependency boundaries

- UI features may call calculation/model services; calculations must not depend on React components or document rendering.
- Engineering catalogue access must be explicit and versioned. Keep runtime environment dependencies outside portable calculation code.
- Report models consume verified calculation snapshots. Renderers format those models rather than inventing alternative engineering formulas.
- Browser and desktop adapters implement a shared file/storage capability contract; features should not repeatedly branch on environment.
- Engine adapters normalize outputs into a declared result contract without discarding engine-specific limitations.
- Keep `shared` small. Domain-specific logic belongs with its feature or calculation module.

Inspect current imports before deciding on these boundaries. Flag cycles and mixed responsibilities with specific examples; do not claim every dependency is a defect.

## Improvements to investigate

### 1. Shared network indexes and calculation context

Some current functions repeatedly search/filter arrays and recursively traverse downstream boards. Measure these paths, then consider constructing once per calculation snapshot:

- Board-by-ID and feeder-by-ID maps.
- Feeders grouped by board and incoming connection indexes.
- Validated parent/child relationships and traversal order.
- Downstream real/reactive-power totals and upstream impedance/drop results.

Reuse them across relevant studies. Preserve phase allocation, signed reactive power, capacitor switching, generator/outage scenarios and all existing engineering policies. A topology error must remain explicit, not be hidden by a cache.

Cache keys/invalidation must include relevant project inputs, catalogue versions, settings, scenario and engine identity. Do not assume object identity alone protects against catalogue changes. Avoid incremental recalculation until correctness and invalidation are demonstrated.

### 2. One consistent result snapshot for studies and reports

Extend the existing run model where necessary instead of introducing a competing result store. Define project revision, calculation version, catalogue basis, units, assumptions, freshness and failure/unverified state.

Keep displayed project metadata and numerical results traceable to the same declared snapshot. Reports must explicitly handle stale calculations. Names may update independently only under a documented policy that does not disguise changed engineering inputs.

### 3. Larger panel-network verification

Measure **100, 500 and 1,000 panels** with realistic feeder counts and network depths. These are test scales, not promised supported limits.

Include shallow and deep MDB/SMDB/DB trees, repeated buildings, mixed-PF and single-phase circuits, parallel cables, capacitor banks, tray grouping, generation/scenarios and representative sheet sets. Keep unrealistic stress fixtures separate from normal engineering projects.

Measure calculation time, application opening, edits, navigation, SLD pan/zoom, table scrolling, save/open, memory and export duration separately. Use warm-up and repeated runs; report median and slow-tail values, hardware, runtime, dataset and measurement boundaries.

An earlier exploratory Node check measured approximately 2/9/13 ms for 100/500/1,000 feeders across 10/50/100 independent shallow boards. It was a single synthetic run, excluded UI/export work and is not a browser benchmark or panel-capacity guarantee. Establish a fresh reproducible baseline before claiming improvement.

### 4. Selective rendering and background calculation

Inspect full-table rendering and SLD element counts. Consider virtualized tables and visible-region/board/sheet rendering where profiling justifies them. Preserve keyboard selection, editing, focus and scroll position. Export complete datasets independently of the visible UI subset.

Consider a worker for sufficiently heavy calculations to keep the main thread responsive. A worker primarily improves responsiveness; communication overhead may increase elapsed time for small jobs. Send versioned requests, reject obsolete responses, support failure/cancellation and include catalogue/settings inputs. Keep whole-network dependencies even when showing a small drawing scope.

### 5. Report output quality

Separate engineering report data from format-specific rendering. Reuse units, number formatting, status terminology, page styles and title-block metadata where appropriate while preserving each output format's needs.

Inspect repeated table headers, long names, page breaks, wide tables, large SLDs, text/vector legibility, bookmarks, revision stamps and missing-data warnings. Measure large export memory/time and avoid keeping every intermediate document in memory unnecessarily.

Verify representative rendered PDF pages as well as numerical content. A string test or folder move does not establish visual output quality. Preserve desktop/browser capabilities and report any meaningful differences.

### 6. Offline storage and recovery

Browser project storage currently uses `localStorage`. Evaluate IndexedDB for larger structured projects/attachments while keeping local file import/export, backup and recovery. Desktop file storage may remain appropriate; do not force both environments into identical persistence internals.

Before migration, specify schema versions, validation, transactional writes, interrupted-migration recovery, storage/quota errors and compatibility with existing files. Preserve the original data until successful verification. IndexedDB remains browser-managed storage, not a replacement for an explicit local backup.

### 7. Startup and module loading

Measure production bundle/startup before changing imports. Consider lazy loading heavy, infrequently used views or export libraries where useful. Preserve offline availability by including required chunks in the existing offline-install/cache workflow. Do not trade startup gains for broken offline export.

## Recommended first review response

Return:

1. A concise assessment of the current directory structure: retain, reorganize, or split, with exact file examples.
2. A proposed folder map and dependency rules, showing how the main existing modules map to it.
3. A ranked table separating maintainability, measured speed, responsiveness, capacity and output-quality benefits.
4. A benchmark/validation plan and realistic risks; label unmeasured benefits as hypotheses.
5. A concrete first batch of **two changes** for owner approval, with files, before/after behavior, checks and rollback.

The preferred first pair is a reproducible benchmark baseline followed by shared network indexes if profiling supports them. If directory-only changes are requested first, propose two small module moves with import updates and behavior-parity checks. Explain why either pair is a useful starting point.

## Implementation and acceptance rules after approval

- Implement only the approved batch. Do not expand it into unrelated engineering corrections or a full folder migration.
- Preserve user changes and earlier ENG fixes; inspect the current state rather than assuming a clean historical checkout.
- Run relevant tests and TypeScript checks. For calculation changes, compare independent fixture results and declared tolerances, including failure/unverified states.
- For performance changes, rerun the same fixtures/environment and report both gains and regressions. Do not advertise a project limit without end-to-end evidence.
- For report changes, inspect rendered representative outputs and numerical parity.
- For storage changes, verify old/new round trips, interrupted writes and recovery without losing originals.
- Report changed files, actual benefit, remaining limits and how the owner can verify. Stop after each two-item batch.

The goal is a clearer, more efficient directory and module structure with demonstrable engineering and user-facing benefits, while retaining local/offline operation and existing project compatibility.
