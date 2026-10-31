# Dependency audit and secret scanning in CI

CI (`.github/workflows/ci.yml`, job `security`) runs on every pull request and every push to `main`:

1. **Dependency audit** — `node scripts/check-audit.mjs` runs `npm audit --omit=dev` (what the
   installed app ships) and `npm audit` (build and test tooling too), at **every severity**, and
   compares the result with [`security/audit-allowlist.json`](../../security/audit-allowlist.json).
   The package has no `node_modules`, but the libraries are compiled into `dist` and `dist-electron`.
   They stay in `dependencies`, so this audit still treats them as shipped code.
2. **Secret scan** — gitleaks 8.30.1 (downloaded from its release and checked against the pinned
   SHA-256) scans the whole git history with the default rules and the exceptions in
   [`.gitleaks.toml`](../../.gitleaks.toml).

Lint, typecheck, unit tests, build and the rendered-PDF tests run in the `check` job beside it.

## When the audit fails

| Message | Meaning | What to do |
| --- | --- | --- |
| Not in the allowlist | A new advisory. | Update the package, or use a narrow `overrides` entry (see [dependency-overrides.md](dependency-overrides.md)). Never `npm audit fix --force` (it downgrades exceljs and electron-builder). Only if no compatible fix exists: add an allowlist entry. |
| Allowlist entry expired | The accepted time is over. | Fix it now, or re-check reachability and renew the entry (with a new reason if anything changed). |
| Allowlisted for tooling only, but in the shipped packages | A `dev` entry now reaches the app. | Treat it as new: fix it, or re-assess it as `prod`. |
| Allowlist: … | An entry is malformed. | Correct it. |
| npm audit failed | No report (network, lockfile). | Re-run; a skipped audit never counts as a pass. |

A **warning** that an entry "matches nothing any more" means the advisory is gone: remove the entry.

## Allowlist entries

Each entry in `security/audit-allowlist.json`:

- `id` — the GHSA id of the advisory (one entry per advisory).
- `package` — the vulnerable package.
- `scope` — `prod` when it may be in the shipped app, `dev` when it is accepted only in build and test
  tooling (CI fails if it shows up in the shipped packages).
- `reason` — why it is acceptable for now: is the vulnerable code reachable, from what input, in the
  app or only when building. "No fix yet" alone is not a reason.
- `expires` — `YYYY-MM-DD`, at most 92 days ahead (CI refuses longer). Renew only after re-checking.
- `tracking` (optional) — the issue or pull request that removes it.

## Secret-scan exceptions

Add a `[[allowlists]]` block to `.gitleaks.toml` only for a confirmed false positive, as narrow as
possible (one rule, named files, an exact pattern) with a description. A real secret is never
allowlisted: revoke and rotate it, then remove it from the code (it stays in the history, so the
rotation is what matters).

Run the scan locally with gitleaks 8.30.1: `gitleaks git --redact --config .gitleaks.toml .`
