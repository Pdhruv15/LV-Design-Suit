import ExcelJS from 'exceljs';
import type { Project } from '../types';
import { buildingInfoOf, summarizeBuilding } from '../calc/building';
import { floorLoads, unitLoads } from '../calc/buildingDesign';
import { panelDf } from './mdSheet';
import { connectedPhaseKw } from './mdSheet';
import { revisionStamp } from '../model/revisions';
import { esc } from './report';

/** One page per building for the submission: levels with area and load,
 * flats and their meters, totals (TCL, MDL, W/m²). */

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface BuildingSheet {
  name: string; use: string; description: string; floors: number; gfaM2: number; buaM2: number; heightM: number;
  rows: { tag: string; level: string; kind: string; grossM2: number; connectedKw: number; demandKw: number; wPerM2: number; dbs: string }[];
  units: { type: string; count: number; connectedKw: number; meters: string }[];
  meters: Record<string, number>;
  tclKw: number; mdlKw: number; df: number; source?: string;
}

export function buildingSheet(project: Project, buildingId: string): BuildingSheet | undefined {
  const info = buildingInfoOf(project);
  const b = info.buildings.find((x) => x.id === buildingId);
  if (!b) return undefined;
  const sum = summarizeBuilding(info, b);
  const fl = floorLoads(project, buildingId);
  const units = unitLoads(project, buildingId);
  const byType = new Map<string, { count: number; kw: number; meters: Map<string, number> }>();
  const meters: Record<string, number> = {};
  for (const u of units) {
    const t = byType.get(u.type) ?? { count: 0, kw: 0, meters: new Map() };
    t.count++; t.kw += u.connectedKw;
    if (u.meter) { t.meters.set(u.meter, (t.meters.get(u.meter) ?? 0) + 1); meters[u.meter] = (meters[u.meter] ?? 0) + 1; }
    byType.set(u.type, t);
  }
  const tclKw = fl.reduce((s, r) => s + r.connectedKw, 0);
  const src = b.riser?.fromBoardId ? project.boards.find((x) => x.id === b.riser!.fromBoardId) : undefined;
  const df = src ? panelDf(project, src) : tclKw ? fl.reduce((s, r) => s + r.demandKw, 0) / tclKw : 1;
  return {
    name: b.name, use: b.use ?? '', description: sum.description, floors: sum.floors, gfaM2: sum.gfaM2, buaM2: sum.buaM2, heightM: sum.heightM,
    rows: fl.map((r) => ({ tag: r.floor.tag, level: r.floor.name, kind: r.floor.level.kind, grossM2: r.grossM2, connectedKw: r.connectedKw, demandKw: r.demandKw, wPerM2: r.grossM2 ? (r.connectedKw * 1000) / r.grossM2 : 0, dbs: r.dbs.join(', ') })),
    units: [...byType.entries()].map(([type, t]) => ({ type, count: t.count, connectedKw: t.kw, meters: [...t.meters.entries()].map(([m, n]) => `${n} × ${m}`).join(', ') })),
    meters, tclKw, mdlKw: tclKw * df, df, source: src ? `${src.id} (TCL incl. services ${f1(connectedPhaseKw(project, src.id).R + connectedPhaseKw(project, src.id).Y + connectedPhaseKw(project, src.id).B)} kW)` : undefined
  };
}

export function buildingSummaryHtml(project: Project, ids: string[]): string {
  const sheets = ids.map((id) => buildingSheet(project, id)).filter((x): x is BuildingSheet => !!x);
  const logo = project.drawing?.logo?.startsWith('data:image/') ? `<img class="logo" src="${esc(project.drawing.logo)}" alt="">` : '';
  const page = (s: BuildingSheet) => `<section class="pg">
  <header>${logo}<div><h1>${esc(s.name)} — building load summary</h1><div class="m">${esc(project.name)} · ${esc(revisionStamp(project))}${project.info?.plotNo ? ` · Plot ${esc(project.info.plotNo)}` : ''}</div></div></header>
  <table class="kv"><tr><th>Use</th><td>${esc(s.use || '—')}</td><th>Floors</th><td>${esc(s.description || '—')} (${s.floors})</td><th>Height</th><td>${f1(s.heightM)} m</td></tr>
  <tr><th>GFA</th><td>${f0(s.gfaM2)} m²</td><th>Built-up area</th><td>${f0(s.buaM2)} m²</td><th>Fed from</th><td>${esc(s.source ?? '—')}</td></tr></table>
  <h2>Load per floor</h2>
  <table><thead><tr><th>Floor</th><th>Level</th><th class="n">Gross area (m²)</th><th class="n">Connected (kW)</th><th class="n">Demand (kW)</th><th class="n">W/m²</th><th>DBs</th></tr></thead><tbody>
  ${s.rows.map((r) => `<tr><td>${esc(r.tag)}</td><td>${esc(r.level)}</td><td class="n">${r.grossM2 ? f0(r.grossM2) : '—'}</td><td class="n">${f2(r.connectedKw)}</td><td class="n">${f2(r.demandKw)}</td><td class="n">${r.wPerM2 ? f1(r.wPerM2) : '—'}</td><td class="m">${esc(r.dbs)}</td></tr>`).join('')}
  <tr class="b"><td colspan="3">Total connected load (TCL) of the floors</td><td class="n">${f2(s.tclKw)}</td><td class="n">${f2(s.rows.reduce((a, r) => a + r.demandKw, 0))}</td><td class="n">${s.gfaM2 ? f1((s.tclKw * 1000) / s.gfaM2) : '—'}</td><td></td></tr></tbody></table>
  ${s.units.length ? `<h2>Flats / tenants</h2><table><thead><tr><th>Unit type</th><th class="n">Units</th><th class="n">Connected (kW, all)</th><th class="n">Per unit (kW)</th><th>Meters</th></tr></thead><tbody>
  ${s.units.map((u) => `<tr><td>${esc(u.type)}</td><td class="n">${u.count}</td><td class="n">${f2(u.connectedKw)}</td><td class="n">${f2(u.connectedKw / u.count)}</td><td>${esc(u.meters)}</td></tr>`).join('')}</tbody></table>
  <p>kWh meters for the meter room: ${Object.entries(s.meters).map(([m, n]) => `<b>${n}</b> × ${esc(m)}`).join(' · ') || '—'}</p>` : ''}
  <table class="kv tot"><tr><th>TCL</th><td>${f2(s.tclKw)} kW</td><th>DF</th><td>${s.df.toFixed(2)}</td><th>MDL</th><td>${f2(s.mdlKw)} kW</td></tr></table>
  <p class="m">Floor loads are the designed DBs' totals (generated from the rooms, or the DB chosen for the rooms). Common services on the source board are in its TCL.</p>
  </section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — building summary</title><style>
  @page { size: A4; margin: 12mm; } body { font: 10px/1.4 Arial, sans-serif; color: #111; margin: 0; } .pg { break-after: page; }
  header { display: flex; gap: 10px; align-items: center; border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 8px; }
  h1 { font-size: 15px; margin: 0; } h2 { font-size: 12px; margin: 12px 0 4px; } .logo { max-height: 12mm; max-width: 45mm; } .m { color: #555; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 0.2mm solid #999; padding: 2px 5px; text-align: left; }
  thead th { background: #1d4f8f; color: #fff; } .n { text-align: right; } .b td { font-weight: 700; } .kv th { background: #eef2f7; width: 13%; } .tot { margin-top: 10px; font-size: 12px; }
  </style></head><body>${sheets.map(page).join('')}</body></html>`;
}

export function buildingSummaryWorkbook(project: Project, ids: string[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const id of ids) {
    const s = buildingSheet(project, id);
    if (!s) continue;
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.addRow([`${s.name} — building load summary`]).font = { bold: true, size: 13 };
    ws.addRow([project.name, revisionStamp(project)]);
    ws.addRow(['Use', s.use, 'Floors', `${s.description} (${s.floors})`, 'GFA (m²)', Math.round(s.gfaM2), 'BUA (m²)', Math.round(s.buaM2)]);
    ws.addRow([]);
    ws.addRow(['Floor', 'Level', 'Gross area (m²)', 'Connected (kW)', 'Demand (kW)', 'W/m²', 'DBs']).font = { bold: true };
    for (const r of s.rows) ws.addRow([r.tag, r.level, r.grossM2 || null, +r.connectedKw.toFixed(2), +r.demandKw.toFixed(2), r.wPerM2 ? +r.wPerM2.toFixed(1) : null, r.dbs]);
    ws.addRow(['Total', '', '', +s.tclKw.toFixed(2), +s.rows.reduce((a, r) => a + r.demandKw, 0).toFixed(2)]).font = { bold: true };
    if (s.units.length) {
      ws.addRow([]);
      ws.addRow(['Unit type', 'Units', 'Connected (kW)', 'Per unit (kW)', 'Meters']).font = { bold: true };
      for (const u of s.units) ws.addRow([u.type, u.count, +u.connectedKw.toFixed(2), +(u.connectedKw / u.count).toFixed(2), u.meters]);
    }
    ws.addRow([]);
    ws.addRow(['TCL (kW)', +s.tclKw.toFixed(2), 'DF', +s.df.toFixed(2), 'MDL (kW)', +s.mdlKw.toFixed(2)]).font = { bold: true };
    ws.columns = [10, 26, 16, 16, 14, 10, 40, 12].map((width) => ({ width }));
  }
  if (!wb.worksheets.length) wb.addWorksheet('Empty');
  return wb;
}
