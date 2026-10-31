# Dependency overrides and accepted advisories

Review by: **2027-01-17** (enforced by `src/model/dependencyOverrides.test.ts`, which fails after this
date until the entries below are reviewed and the date moved).

`npm audit --omit=dev` and `npm audit` are checked against the temporary acceptance in
`security/audit-allowlist.json`. Never run `npm audit fix --force` here: it downgrades `exceljs` to
3.4.0 and `electron-builder` to 26.5.0.

## Overrides

| Override | Why | Reachability before the fix | Remove when |
| --- | --- | --- | --- |
| `exceljs` → `uuid` **11.1.1** | GHSA-w5hq-g745-h8pq: uuid < 11.1.1 misses a buffer bounds check in v3 / v5 / v6 when the caller passes `buf`. exceljs 4.4.0 (latest stable) pins `uuid ^8.3.0`. | Not reachable: exceljs only calls `uuid.v4()` with no arguments (`lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`). | exceljs releases a version depending on uuid ≥ 11.1.1. |
| `@electron/get` → `global-agent` **4.1.3** | GHSA-hp3w-g68c-fv3c: every `sprintf-js` version is open to a denial of service through unbounded precision specifiers. It came in through electron-builder → app-builder-lib → @electron/get 3 → global-agent 3 → roarr 2 → sprintf-js. global-agent 4 no longer uses roarr. | Build time only (packaging; nothing in the shipped app). Reached only with `ELECTRON_GET_USE_PROXY` set, and the format strings are the libraries' own log messages. | app-builder-lib depends on an @electron/get without global-agent 3 (electron-builder 26.17.0 still uses @electron/get ^3). |
| `shell-quote` **1.11.0** | Earlier override, kept as it was. | — | — |

uuid 11 is the last major that still ships CommonJS (`require('uuid')`, which exceljs uses); 12 and
later are ESM only, so do not raise the override past 11.x while exceljs is CommonJS.

## Accepted (not visible to npm audit)

- **uuid 8 inside exceljs's browser bundle.** The renderer imports exceljs through its prebuilt
  `dist/exceljs.min.js` (the package's `browser` field), which embeds its own copy of uuid 8; an
  npm override cannot change it. Accepted until the review date: the bundle only calls `v4()` without
  a buffer, the affected v3 / v5 / v6 paths are never used. The main process (LV Database workbooks)
  uses the Node build and gets the overridden uuid 11.1.1.

## Temporarily allowlisted

- **minimatch before 11.0.1 (GHSA-g3hv-75wg-m249).** ExcelJS 4.4.0 brings minimatch 3 and 5 through
  its archive glob helpers. Workbook export uses library-owned patterns; project data supplies workbook
  values and filenames, not the glob pattern needed for the reported amplification. The patched
  minimatch major is incompatible with the existing `glob` dependency, so the advisory is accepted
  until the review date while waiting for compatible upstream releases.

## Checked with the overrides and allowlist (2026-10-31)

- Dependency audit, lint, typecheck, unit tests, `npm run build`.
- ExcelJS round trip (Node) with a conditional format whose ID comes from `uuid.v4()`.
- `global-agent` 4.1.3 exposes `bootstrap()` as @electron/get 3 calls it.
- `electron-builder --mac dir --arm64` (unsigned) with `ELECTRON_GET_USE_PROXY=1`: packaged; the app
  contains uuid 11.1.1 and no sprintf-js / roarr / global-agent; ExcelJS works in the packaged runtime.

## At the review

Run `npm outdated exceljs electron-builder app-builder-lib @electron/get uuid global-agent`,
`npm audit --omit=dev` and `npm audit`. Drop an override once upstream no longer needs it; otherwise
re-check reachability, update this page and move the review date (at most three months).
