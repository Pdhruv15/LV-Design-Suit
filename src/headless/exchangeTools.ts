import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { decide, readPackage, reviewPackage, type Review } from '../exchange/inbox';
import { openProject } from './project';
import { edit } from './editTools';
import type { Tool, ToolContext } from './tools';

/** Exchange packages from other programs (rooms from CAD / IFC, luminaires from DIALux, ELV loads): check one, review
 * it against a project, and apply what the engineer accepted (src/exchange/inbox.ts). Applying previews by default and
 * needs the engineer's name; nothing is accepted on anyone's behalf. The rooms export is export_rooms_package. */

const MAX_BYTES = 20 * 1024 * 1024;
const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const project = z.string().describe('Project file name in the projects folder, as given by list_projects');
const file = z.string().describe('Exchange package file (JSON): a path, or a file name in the projects folder');

/** Reads a package file: on MCP and the local API, only from inside the projects folder. */
export function readFile(ref: string, ctx: ToolContext) {
  const name = ref.trim();
  if (!name) throw new Error('Give the exchange package file.');
  const candidates = path.isAbsolute(name) ? [name] : [path.resolve(ctx.folder, name), ...(ctx.anywhere ? [path.resolve(name)] : [])];
  const full = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!full) throw new Error(`No file "${name}"${ctx.anywhere ? '' : ` in ${ctx.folder}`}.`);
  if (!ctx.anywhere) {
    const rel = path.relative(path.resolve(ctx.folder), path.resolve(full));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Only files inside the projects folder (${ctx.folder}) can be read here.`);
  }
  if (fs.statSync(full).size > MAX_BYTES) throw new Error(`${path.basename(full)} is larger than 20 MB.`);
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(full, 'utf-8')); } catch (e) { throw new Error(`${path.basename(full)} is not valid JSON (${(e as Error).message}).`); }
  return { raw, name: path.basename(full) };
}

function checked(ref: string, ctx: ToolContext) {
  const { raw, name } = readFile(ref, ctx);
  const read = readPackage(raw, sha256);
  if (!read.ok) throw new Error(`${name} cannot be used: ${read.errors.slice(0, 20).map((e) => `${e.row ? `row ${e.row}` : e.field ?? 'package'}${e.row && e.field ? ` ${e.field}` : ''}: ${e.message}`).join('; ')}`);
  return { ...read, name };
}

const summary = (r: Review, limit: number) => ({
  kind: r.kind, source: r.source, hash: r.hash, counts: r.counts,
  changes: r.changes.filter((c) => c.kind !== 'same').slice(0, limit),
  ...(r.changes.filter((c) => c.kind !== 'same').length > limit ? { more: r.changes.filter((c) => c.kind !== 'same').length - limit } : {}),
  ...(r.problems.length ? { problems: r.problems } : {}),
  ...(r.seenBefore ? { seenBefore: `${r.seenBefore.id}: ${r.seenBefore.decision} by ${r.seenBefore.by} on ${r.seenBefore.at.slice(0, 10)}` } : {})
});

export const EXCHANGE_TOOLS: Tool[] = [
  {
    name: 'exchange_check',
    title: 'Check an exchange package',
    description: 'Checks an exchange package file (rooms, luminaires or ELV loads; contract lvds.exchange version 1) on its own: shape, units, duplicates and its sha256. Reports the rows that are wrong.',
    input: { file },
    run: (a, ctx) => {
      const { raw, name } = readFile(String(a.file), ctx);
      const read = readPackage(raw, sha256);
      if (!read.ok) return { file: name, ok: false, errors: read.errors };
      return { file: name, ok: true, kind: read.pkg.kind, source: read.pkg.source, exportedAt: read.pkg.exportedAt, items: read.pkg.items.length, hash: read.hash, ...(read.warnings.length ? { warnings: read.warnings } : {}) };
    }
  },
  {
    name: 'exchange_review',
    title: 'Review an exchange package against a project',
    description: 'What accepting a package would do to the project: rooms added, changed, renamed or removed (matched by source ID, then by name on the level), or luminaire / ELV load rows added, changed or removed since the last accepted package from the same file. Rows that cannot be applied are listed as problems. Nothing is written.',
    input: { project, file, limit: z.number().int().min(1).max(5000).default(200).describe('Most changes to list') },
    usesProject: true,
    run: (a, ctx) => {
      const { project: p } = openProject({ ref: String(a.project ?? ''), folder: ctx.folder, anywhere: ctx.anywhere });
      const { pkg, hash, warnings, name } = checked(String(a.file), ctx);
      return { file: name, ...summary(reviewPackage(p, pkg, hash), Number(a.limit)), ...(warnings.length ? { warnings } : {}) };
    }
  },
  {
    name: 'exchange_apply',
    title: 'Apply an exchange package',
    description: 'Applies the changes of a package that the engineer accepted, and logs the decision with the package hash. accept: "all", "none" (reject the package), or the change keys from exchange_review. Rooms go to Building information; accepted luminaire and ELV load rows are kept in the project for the load calculations. Preview first; applying needs approvedBy.',
    input: {
      project, file,
      accept: z.union([z.enum(['all', 'none']), z.array(z.string()).min(1).max(20000)]).describe('"all", "none", or a list of change keys'),
      approvedBy: z.string().trim().min(2).optional().describe('Name of the engineer who made the decision (required to apply)'),
      note: z.string().max(500).optional(),
      mode: z.enum(['preview', 'apply']).default('preview').describe('preview = show what would change, nothing is written; apply = change the project file (a backup is kept; undo_change puts it back)')
    },
    usesProject: true, writes: true,
    run: (a, ctx) => {
      const { pkg, hash, name } = checked(String(a.file), ctx);
      const by = typeof a.approvedBy === 'string' ? a.approvedBy.trim() : '';
      if (a.mode === 'apply' && by.length < 2) throw new Error('Applying needs approvedBy: the name of the engineer who accepted the changes.');
      return edit(a, ctx, 'exchange_apply', a.mode === 'apply', (p) => {
        const accept = a.accept === 'all' ? 'all' : a.accept === 'none' ? [] : (a.accept as string[]);
        const out = decide(p, pkg, hash, { accept, by: by || 'preview', at: new Date().toISOString(), ...(typeof a.note === 'string' ? { note: a.note } : {}) });
        const r = out.record;
        return {
          next: out.project,
          summary: `${name}: ${r.decision} (${Object.entries(r.accepted).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'} of ${r.offered} change${r.offered === 1 ? '' : 's'}), ${r.id}`,
          details: summary(out.review, 200)
        };
      });
    }
  }
];
