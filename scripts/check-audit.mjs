#!/usr/bin/env node
// Dependency audit for CI, against a documented allowlist (security/audit-allowlist.json; the policy is in
// docs/engineering/dependency-audit.md).
//
// Runs `npm audit --omit=dev` (what the app ships) and `npm audit` (everything, build and test tooling
// too), at every severity. The run fails when:
//   - an advisory is found that the allowlist does not name,
//   - an advisory in the shipped packages is listed only for tooling (scope "dev"),
//   - a listed advisory is still found after its expiry date,
//   - an allowlist entry is malformed or expires more than 92 days ahead,
//   - npm audit itself fails (no network, bad lockfile): a skipped audit never passes.
// An entry that matches nothing any more is a warning: remove it.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAX_DAYS_AHEAD = 92;
const GHSA = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;
const DAY = 86400000;

/** Advisories in an `npm audit --json` report (v2): id (GHSA), package, severity, title, url. */
export function advisoriesOf(report) {
  if (!report || typeof report !== 'object' || !report.vulnerabilities) throw new Error('not an npm audit --json report');
  const out = new Map();
  for (const v of Object.values(report.vulnerabilities)) {
    for (const via of v.via ?? []) {
      if (typeof via !== 'object' || !via) continue; // a package name: the advisory is listed under that package
      const id = String(via.url ?? '').match(/GHSA(-[a-z0-9]{4}){3}/i)?.[0] ?? `npm-${via.source}`;
      if (!out.has(id)) out.set(id, { id, package: via.name, severity: via.severity, title: via.title, url: via.url });
    }
  }
  return [...out.values()];
}

/** Checks the allowlist itself. */
export function allowlistProblems(allowlist, today) {
  const problems = [];
  if (!allowlist || !Array.isArray(allowlist.advisories)) return ['the allowlist has no "advisories" list'];
  const seen = new Set();
  const limit = new Date(Date.parse(today) + MAX_DAYS_AHEAD * DAY).toISOString().slice(0, 10);
  for (const [i, e] of allowlist.advisories.entries()) {
    const at = `entry ${i + 1}${e && e.id ? ` (${e.id})` : ''}`;
    if (!e || typeof e !== 'object') { problems.push(`${at} is not an object`); continue; }
    if (!GHSA.test(String(e.id))) problems.push(`${at}: "id" must be a GHSA id`);
    if (seen.has(e.id)) problems.push(`${at}: listed twice`);
    seen.add(e.id);
    if (typeof e.package !== 'string' || !e.package) problems.push(`${at}: "package" is missing`);
    if (e.scope !== 'prod' && e.scope !== 'dev') problems.push(`${at}: "scope" must be "prod" (may be in the shipped app) or "dev" (build / test tooling only)`);
    if (typeof e.reason !== 'string' || e.reason.trim().length < 20) problems.push(`${at}: "reason" must explain why it is acceptable (reachability, exposure)`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.expires)) || Number.isNaN(Date.parse(e.expires))) problems.push(`${at}: "expires" must be a date (YYYY-MM-DD)`);
    else if (e.expires > limit) problems.push(`${at}: expires ${e.expires}, more than ${MAX_DAYS_AHEAD} days ahead (latest ${limit})`);
  }
  return problems;
}

/** The verdict for the two audit reports against the allowlist on `today` (YYYY-MM-DD). */
export function evaluate({ prod, full, allowlist, today }) {
  const errors = allowlistProblems(allowlist, today).map((p) => `Allowlist: ${p}`);
  const warnings = [];
  const entries = new Map((allowlist?.advisories ?? []).map((e) => [e.id, e]));
  const prodFound = advisoriesOf(prod);
  const prodIds = new Set(prodFound.map((a) => a.id));
  const allFound = [...prodFound, ...advisoriesOf(full).filter((a) => !prodIds.has(a.id))];
  const used = new Set();
  for (const a of allFound) {
    const shipped = prodIds.has(a.id);
    const where = shipped ? 'shipped packages' : 'build / test tooling';
    const what = `${a.id} (${a.package}, ${a.severity}) in ${where}: ${a.title}${a.url ? ` — ${a.url}` : ''}`;
    const e = entries.get(a.id);
    if (!e) { errors.push(`Not in the allowlist: ${what}. Fix it, or add it to security/audit-allowlist.json with its reachability and an expiry.`); continue; }
    used.add(a.id);
    if (shipped && e.scope !== 'prod') errors.push(`Allowlisted for tooling only, but in the shipped packages: ${what}`);
    if (today > e.expires) errors.push(`Allowlist entry expired on ${e.expires}: ${what}. Fix it or review the entry.`);
  }
  for (const e of entries.values()) if (!used.has(e.id)) warnings.push(`Allowlist entry ${e.id} (${e.package}) matches nothing any more — remove it.`);
  return { errors, warnings, found: allFound.length };
}

/** `npm audit --json`, which exits non-zero when it finds something: the report is still on stdout. */
function npmAudit(args) {
  let out;
  try {
    out = execFileSync('npm', ['audit', '--json', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = e.stdout;
    if (!out) throw new Error(`npm audit ${args.join(' ')} failed: ${String(e.stderr || e.message).trim()}`);
  }
  const report = JSON.parse(out);
  if (report.error) throw new Error(`npm audit ${args.join(' ')} failed: ${report.error.summary || JSON.stringify(report.error)}`);
  return report;
}

function main() {
  const allowlistPath = new URL('../security/audit-allowlist.json', import.meta.url);
  const today = process.env.AUDIT_TODAY || new Date().toISOString().slice(0, 10);
  const gh = !!process.env.GITHUB_ACTIONS;
  try {
    const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
    const { errors, warnings, found } = evaluate({ prod: npmAudit(['--omit=dev']), full: npmAudit([]), allowlist, today });
    for (const w of warnings) console.log(gh ? `::warning title=Dependency audit::${w}` : `warning: ${w}`);
    for (const e of errors) console.log(gh ? `::error title=Dependency audit::${e}` : `error: ${e}`);
    console.log(`Dependency audit: ${found} advisor${found === 1 ? 'y' : 'ies'} found, ${errors.length} problem${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`);
    process.exit(errors.length ? 1 : 0);
  } catch (e) {
    console.log(gh ? `::error title=Dependency audit::${e.message}` : `error: ${e.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
