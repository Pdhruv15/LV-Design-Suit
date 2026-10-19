import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { buildDashboard } from '../calc/dashboard';
import { buildBom } from '../calc/bom';
import { runCalculations } from '../calc/runs';
import { CATALOGUE, unavailable, type ExportContext } from '../components/docs/exportCatalogue';
import { buildBoqWorkbook } from '../docs/boqWorkbook';
import { buildFormWorkbook, workbookBytes } from '../docs/formWorkbook';
import { buildSheetDxfPages } from '../docs/sheetDxf';
import type { SheetInfo } from '../docs/sldSheet';
import { earthingDrawing } from '../diagram/earthingDrawing';
import { earthingLayout } from '../model/earthingPlan';
import { autoSize } from '../model/drawingSet';
import { numberBom } from '../model/boqRevisions';
import { priceBom } from '../model/priceList';
import { safeFileName } from '../util/files';
import type { Project } from '../types';
import { openProject } from './project';
import type { Tool, ToolContext } from './tools';
import { agentDir } from './write';

/** Stage 3: exports. Each export tool previews by default: the files it would make, and whether the design is ready
 * (check failures, proposals waiting in Reports → Changes). Making the files needs the name of the engineer who
 * approved the export, and is refused while checks fail or proposals wait unless the engineer says to export anyway.
 * Files go to <projects folder>/Exports/<project>/<date>/, never over an existing file; every export is logged.
 *
 * Documents come from the app's own export catalogue (Reports → Export centre), as HTML: open one in a browser and
 * print to PDF. Drawing sheets (SLD, panel, riser) need the app's drawing canvas; of the drawings, only the earthing
 * schematic can be exported as DXF here. */

const project = z.string().describe('Project file name in the projects folder, as given by list_projects');
const approvedBy = z.string().trim().min(2).optional().describe('Name of the engineer who approved this export (required to export)');
const exportAnyway = z.boolean().default(false).describe('Export even though checks fail or proposals are waiting (the engineer decided so)');
const mode = z.enum(['preview', 'export']).default('preview').describe('preview = list the files and readiness, nothing is written; export = write the files (needs approvedBy)');

interface OutFile { name: string; data: string | Uint8Array; about: string }
interface ExportEntry { id: string; at: string; file: string; tool: string; approvedBy: string; exportedAnyway: boolean; readiness: Readiness; files: string[] }
interface Readiness { fail: number; check: number; proposalsWaiting: string[] }

const exportsLog = (folder: string) => path.join(agentDir(folder), 'exports.jsonl');

function readiness(p: Project): Readiness {
  const d = buildDashboard(p, runCalculations(p));
  return {
    fail: d.todo.filter((t) => t.status === 'bad').length,
    check: d.todo.filter((t) => t.status === 'warn').length,
    proposalsWaiting: (p.modifications ?? []).filter((m) => (m.status === 'proposed' || m.status === 'review' || (m.status === 'accepted' && !m.applied))).map((m) => `${m.id} ${m.title} (${m.status}${m.status === 'accepted' ? ', not applied' : ''})`)
  };
}

/** A name not taken in the folder: "x.xlsx", else "x (2).xlsx" … */
function freeName(dir: string, name: string): string {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let out = name;
  for (let n = 2; fs.existsSync(path.join(dir, out)); n++) out = `${base} (${n})${ext}`;
  return out;
}

/** The shared preview / approval / write path of every export tool. */
async function runExport(args: Record<string, unknown>, ctx: ToolContext, tool: string, make: (p: Project) => Promise<OutFile[]> | OutFile[]) {
  const { project: p, file } = openProject({ ref: String(args.project ?? ''), folder: ctx.folder, anywhere: ctx.anywhere });
  const ready = readiness(p);
  const files = await make(p);
  if (!files.length) throw new Error('Nothing to export from this project.');
  const stem = path.basename(file).replace(/\.json$/i, '');
  const dir = path.join(ctx.folder, 'Exports', safeFileName(stem), new Date().toISOString().slice(0, 10));
  const problems = [
    ...(ready.fail ? [`${ready.fail} item(s) fail the checks (run_checks)`] : []),
    ...(ready.proposalsWaiting.length ? [`proposals waiting in Reports → Changes: ${ready.proposalsWaiting.join('; ')}`] : [])
  ];
  const listing = files.map((f) => ({ file: f.name, about: f.about }));
  if (args.mode !== 'export') {
    return {
      mode: 'preview', written: false, folder: dir, files: listing, readiness: ready,
      next: problems.length
        ? `Not ready: ${problems.join('; ')}. Fix these first, or export with exportAnyway true if the engineer decides so. Exporting needs approvedBy (the engineer's name).`
        : 'Ready. Call again with mode export and approvedBy (the name of the engineer who approved it).'
    };
  }
  const by = typeof args.approvedBy === 'string' ? args.approvedBy.trim() : '';
  if (by.length < 2) throw new Error('Exporting needs approvedBy: the name of the engineer who approved this export.');
  if (problems.length && args.exportAnyway !== true) throw new Error(`Not exported: ${problems.join('; ')}. Fix these first, or set exportAnyway true if the engineer decides to export as it is.`);
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const f of files) {
    const name = freeName(dir, f.name);
    fs.writeFileSync(path.join(dir, name), f.data);
    written.push(path.join(dir, name));
  }
  const entry: ExportEntry = { id: `E-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`, at: new Date().toISOString(), file: path.basename(file), tool, approvedBy: by, exportedAnyway: problems.length > 0, readiness: ready, files: written.map((w) => path.relative(ctx.folder, w)) };
  fs.mkdirSync(agentDir(ctx.folder), { recursive: true });
  fs.appendFileSync(exportsLog(ctx.folder), JSON.stringify(entry) + '\n', 'utf-8');
  return { mode: 'done', written: true, export: entry.id, approvedBy: by, ...(entry.exportedAnyway ? { exportedAnyway: problems } : {}), files: written };
}

const exportContext = (p: Project): ExportContext => ({ project: p, run: runCalculations(p), stale: [] });
const REPORT_KEYS = CATALOGUE.map((e) => e.key) as [string, ...string[]];

export const EXPORT_TOOLS: Tool[] = [
  {
    name: 'list_exports',
    title: 'Documents that can be exported',
    description: 'The documents this project can export (the app\'s Export centre list, plus the forms and BOQ workbooks and the earthing DXF), and why any cannot be made yet.',
    input: { project },
    usesProject: true,
    run: (a, ctx) => {
      const { project: p } = openProject({ ref: String(a.project ?? ''), folder: ctx.folder, anywhere: ctx.anywhere });
      const c = exportContext(p);
      return {
        reports: CATALOGUE.map((e) => ({ report: e.key, title: e.title, group: e.category, ...(unavailable(e, c) ? { unavailable: unavailable(e, c) } : {}) })),
        workbooks: [{ tool: 'export_forms_xlsx', title: 'DEWA connected load, MD, TCL and DB schedule forms (.xlsx)' }, { tool: 'export_boq_xlsx', title: 'Bill of quantities (.xlsx)' }],
        drawings: [{ tool: 'export_dxf', title: 'Earthing schematic (.dxf)', ...(earthingLayout(p).items.length ? {} : { unavailable: 'No equipment to earth' }) }, { title: 'SLD, panel and riser sheets', unavailable: 'Export from the app (Reports → Drawings): they need its drawing canvas' }],
        readiness: readiness(p)
      };
    }
  },
  {
    name: 'export_report',
    title: 'Export a report (HTML)',
    description: 'Makes one document of the app\'s Export centre (calculation report, voltage drop, schedules, DEWA forms, BOQ, project summary …) as HTML, with the same content as the app; open it in a browser and print to PDF. Preview first; exporting needs approvedBy.',
    input: { project, report: z.enum(REPORT_KEYS).describe(CATALOGUE.map((e) => `${e.key} = ${e.title}`).join('; ')), approvedBy, exportAnyway, mode },
    usesProject: true, writes: true,
    run: (a, ctx) => runExport(a, ctx, 'export_report', (p) => {
      const entry = CATALOGUE.find((e) => e.key === a.report)!;
      const c = exportContext(p);
      const why = unavailable(entry, c);
      if (why) throw new Error(`${entry.title} cannot be made: ${why}.`);
      return entry.build(c).map((part) => ({ name: `${part.file}.html`, data: part.html, about: `${part.title} (HTML; print to PDF from a browser, ${part.page.pageSize ?? 'A4'}${part.page.landscape ? ' landscape' : ''})` }));
    })
  },
  {
    name: 'export_forms_xlsx',
    title: 'Export DEWA forms (Excel)',
    description: 'The DEWA connected load / maximum demand, TCL summary, riser and DB load schedule forms as one Excel workbook, as the app makes it. Optionally only some panels or forms. Preview first; exporting needs approvedBy.',
    input: {
      project, panels: z.array(z.string()).optional().describe('Only these panels (default all)'),
      forms: z.array(z.enum(['tx', 'riser', 'md', 'db'])).optional().describe('tx = TCL summary, riser = busbar risers, md = connected load & MD, db = DB load schedules (default all)'),
      approvedBy, exportAnyway, mode
    },
    usesProject: true, writes: true,
    run: (a, ctx) => runExport(a, ctx, 'export_forms_xlsx', async (p) => {
      const panels = a.panels as string[] | undefined;
      const unknown = panels?.filter((id) => !p.boards.some((b) => b.id === id));
      if (unknown?.length) throw new Error(`No panel ${unknown.join(', ')}.`);
      const wb = buildFormWorkbook(p, { boardIds: panels, forms: a.forms as ('tx' | 'riser' | 'md' | 'db')[] | undefined });
      return [{ name: `${safeFileName(`${p.name} - DEWA load forms`)}.xlsx`, data: await workbookBytes(wb), about: `Excel workbook, ${wb.worksheets.length} sheet(s): ${wb.worksheets.map((w) => w.name).slice(0, 8).join(', ')}${wb.worksheets.length > 8 ? ' …' : ''}` }];
    })
  },
  {
    name: 'export_boq_xlsx',
    title: 'Export BOQ (Excel)',
    description: 'The bill of quantities by tender section, priced from the project price list and numbered by BOQ revision, as the app makes it. Preview first; exporting needs approvedBy.',
    input: { project, approvedBy, exportAnyway, mode },
    usesProject: true, writes: true,
    run: (a, ctx) => runExport(a, ctx, 'export_boq_xlsx', async (p) => {
      const bom = numberBom(priceBom(buildBom(p), p.priceList, p.boq), p.boqRevisions);
      const wb = buildBoqWorkbook(p, bom, p.priceList);
      return [{ name: `${safeFileName(`${p.name} - BOQ`)}.xlsx`, data: await workbookBytes(wb), about: 'Excel workbook: bill of quantities' }];
    })
  },
  {
    name: 'export_dxf',
    title: 'Export earthing schematic (DXF)',
    description: 'The earthing schematic as DXF sheets with the title block, as the app makes them. Other drawings (SLD, panel, riser) are exported from the app, which draws them. Preview first; exporting needs approvedBy.',
    input: { project, drawing: z.enum(['earthing']).default('earthing'), approvedBy, exportAnyway, mode },
    usesProject: true, writes: true,
    run: (a, ctx) => runExport(a, ctx, 'export_dxf', (p) => {
      if (!earthingLayout(p).items.length) throw new Error('No equipment to earth in this project.');
      const d = earthingDrawing(p, undefined, true, { mono: true });
      const set = p.drawingSet;
      const i = set?.sheets.findIndex((s) => s.kind === 'earthing') ?? -1;
      const s = i >= 0 ? set!.sheets[i] : undefined;
      const size = s && s.size !== 'auto' ? s.size : autoSize(d.w, d.h).size;
      const info: SheetInfo = s
        ? { no: s.number, title: s.title, count: set!.sheets.length, index: i + 1, status: s.status || set!.status || undefined, rev: s.rev || undefined, date: s.date || undefined, drawnBy: s.drawnBy || undefined, checkedBy: s.checkedBy || undefined, approvedBy: s.approvedBy || undefined }
        : { no: 'E-EAR-001', title: 'Earthing schematic diagram', count: 1, index: 1 };
      const pages = buildSheetDxfPages(p, d.svg, size, info);
      const base = safeFileName(info.no || 'earthing');
      return pages.map((pg) => ({ name: `${base}${pg.count > 1 ? `-${pg.index}` : ''}.dxf`, data: pg.data, about: `DXF, ${size}${pg.continuation ? ', continuation sheet' : ''}${pg.warnings.length ? ` — ${pg.warnings.join('; ')}` : ''}` }));
    })
  }
];
