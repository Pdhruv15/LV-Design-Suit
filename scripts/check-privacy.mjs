#!/usr/bin/env node
// Privacy check for CI (policy: docs/privacy.md; exceptions: security/privacy-allowlist.json).
//
// Scans every tracked file (text and binary bytes) for:
//   - personal absolute paths: /Users/<name>/, /home/<name>/, C:\Users\<name>\ (placeholder names allowed),
//   - e-mail addresses other than no-reply and example domains,
// and, with --commits <range> (pull requests), the author and committer of each commit in the range for
// addresses Git made up from the computer's name (<user>@Mac.lan, <user>@<Someones-MacBook>.local).
// Secrets are left to gitleaks (.gitleaks.toml), which CI runs on the whole history.
// A finding prints the file, line and a shortened match (never the full value) and fails the run.
// Exceptions are exact strings for named files, each with a reason. An exception that matches nothing is a warning.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Folder names that are placeholders, not a person's account. */
export const PLACEHOLDERS = new Set(['x', 'me', 'you', 'user', 'username', 'name', '<user>', '<you>', '<name>', 'runner', 'someone', 'demo', 'example', 'shared', 'public', 'default', 'admin', 'test', 'jdoe', 'janedoe', 'johndoe', '...', '…', '$user', '%username%', '${user}', 'yourname', 'your-name']);
/** E-mail domains that are never a person's real address. */
const SAFE_EMAIL = /@(users\.noreply\.github\.com|noreply\.github\.com|anthropic\.com|example\.(com|org|net)|[\w.-]+\.example|[\w.-]+\.(test|invalid|localhost))$/i;
/** Hostname-style addresses Git invents when no user.email is set. */
export const DEVICE_EMAIL = /@[\w.-]*(\.local|\.lan|\.localdomain|\.home|\.internal)$|@[\w-]*(macbook|imac|mac-mini|-pc|desktop-|laptop)/i;

const PATH = /(?:\/Users\/|\/home\/|[A-Za-z]:\\{1,2}Users\\{1,2})([^/\\\s"'`<>)\]]+)/g;
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g;

/** Shown in a finding: enough to find it, not the whole value. */
export const shorten = (s) => (s.length <= 8 ? s.slice(0, 2) + '…' : s.slice(0, 6) + '…' + s.slice(-3));

/** Findings in one file's content: { line, kind, match }. */
export function scanText(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((l, i) => {
    for (const m of l.matchAll(PATH)) {
      const who = m[1].toLowerCase();
      if (!PLACEHOLDERS.has(who) && !/^(shared|public|runner)$/.test(who)) out.push({ line: i + 1, kind: 'personal path', match: m[0] });
    }
    for (const m of l.matchAll(EMAIL)) {
      const e = m[0];
      // npm scopes and versions look like addresses (@types/node@1.2.3, pkg@1.0.0): not e-mail.
      if (/^\d/.test(e.split('@')[1]) || l.slice(Math.max(0, m.index - 1), m.index) === '/') continue;
      if (!SAFE_EMAIL.test(e)) out.push({ line: i + 1, kind: 'e-mail address', match: e });
    }
  });
  return out;
}

export function loadAllowlist(file) {
  const list = JSON.parse(readFileSync(file, 'utf-8')).exceptions ?? [];
  for (const e of list) if (!e.file || !e.match || !e.reason) throw new Error(`privacy allowlist entry needs file, match and reason: ${JSON.stringify(e)}`);
  return list;
}

const SKIP = /^(package-lock\.json|node_modules\/)/;

export function scanRepo(root, allow) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf-8' }).split('\0').filter((f) => f && !SKIP.test(f));
  const used = new Set();
  const findings = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(`${root}/${f}`).toString('latin1'); } catch { continue; } // deleted in the working tree
    for (const x of scanText(text)) {
      const a = allow.findIndex((e) => e.file === f && x.match.includes(e.match));
      if (a >= 0) { used.add(a); continue; }
      findings.push({ file: f, ...x });
    }
  }
  return { findings, unused: allow.filter((_, i) => !used.has(i)), files: files.length };
}

export function scanCommits(root, range) {
  const log = execFileSync('git', ['log', '--format=%h%x09%ae%x09%ce', range], { cwd: root, encoding: 'utf-8' }).trim();
  const out = [];
  for (const row of log ? log.split('\n') : []) {
    const [sha, ae, ce] = row.split('\t');
    for (const e of new Set([ae, ce])) if (DEVICE_EMAIL.test(e)) out.push({ sha, email: e });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const allow = loadAllowlist(`${root}/security/privacy-allowlist.json`);
  const { findings, unused, files } = scanRepo(root, allow);
  for (const f of findings) console.error(`${f.file}:${f.line}: ${f.kind}: ${shorten(f.match)}`);
  for (const u of unused) console.warn(`warning: privacy allowlist entry matches nothing (remove it): ${u.file} "${shorten(u.match)}"`);
  const i = process.argv.indexOf('--commits');
  const commits = i > 0 && process.argv[i + 1] ? scanCommits(root, process.argv[i + 1]) : [];
  for (const c of commits) console.error(`commit ${c.sha}: author or committer address made from a computer name (…@…${c.email.slice(c.email.lastIndexOf('.'))}). Set user.email to your GitHub no-reply address and amend: see docs/privacy.md.`);
  console.log(`Privacy check: ${files} files${i > 0 ? `, commits ${process.argv[i + 1]}` : ''} — ${findings.length + commits.length} finding(s).`);
  process.exit(findings.length || commits.length ? 1 : 0);
}
