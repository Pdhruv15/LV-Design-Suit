import type { Project } from '../types';
import { lengthText, sizesText, type DashBar, type Dashboard } from '../calc/dashboard';
import { revisionStamp } from '../model/revisions';
import { esc } from './report';

/** The project dashboard as a one-page A4 landscape summary (a cover sheet
 * for the client or a submission): project card, headline numbers, load by
 * type, transformer loading, load per level and the to-do list. */

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

const bars = (bs: DashBar[], empty: string) => {
  if (!bs.length) return `<p class="m">${esc(empty)}</p>`;
  const max = Math.max(...bs.map((b) => b.kw));
  return `<table class="bars">${bs.slice(0, 10).map((b) => `<tr><td class="bl">${esc(b.label)}</td><td class="bt"><div class="bf" style="width:${Math.max(1, (b.kw / max) * 100).toFixed(1)}%"></div></td><td class="bv">${f0(b.kw)} kW <span class="m">${f0(b.pct)} %</span></td></tr>`).join('')}</table>${bs.length > 10 ? `<p class="m">+ ${bs.length - 10} more</p>` : ''}`;
};

export function buildDashboardHtml(project: Project, d: Dashboard): string {
  const i = d.info;
  const logo = project.drawing?.logo?.startsWith('data:image/') ? `<img class="logo" src="${esc(project.drawing.logo)}" alt="">` : '';
  const fails = d.studies.reduce((a, s) => a + s.fail, 0);
  const checks = d.studies.reduce((a, s) => a + s.check, 0);
  const passes = d.studies.reduce((a, s) => a + s.pass, 0);
  const tiles: [string, string, string][] = [
    ['Connected load (TCL)', `${f0(d.connectedKw)} kW`, ''],
    ['Maximum demand', `${f0(d.demandKw)} kW`, `${f0(d.demandKva)} kVA · PF ${d.pf.toFixed(2)}`],
    ['Transformers', d.transformers.length ? sizesText(d.transformers.map((t) => t.kva)) : '—', d.transformers.length ? `${f0((d.demandKva / Math.max(1, d.transformerKva)) * 100)} % loaded · ${d.substations} substation(s)` : ''],
    ['Generators', d.generators.length ? sizesText(d.generators.map((g) => g.kva)) : '—', d.generatorLoadingPct !== undefined ? `${f0(d.generatorLoadingPct)} % loaded` : ''],
    ['Panels', String(d.panels.total), d.panels.byKind.map((k) => `${k.n} ${k.label}`).join(' · ')],
    ['Total area', d.area ? `${f0(d.area.gfaM2)} m²` : '—', d.area?.source === 'building' ? `GFA · ${d.area.floors} floors` : d.area ? d.area.source : ''],
    ['Power density', d.density ? `${f1(d.density.connected)} W/m²` : '—', d.density ? `connected · ${f1(d.density.demand)} W/m² demand` : ''],
    ['Capacitors', d.capacitorKvar ? `${f0(d.capacitorKvar)} kvar` : '—', ''],
    ['Cables', lengthText(d.cableM), `${d.cableRuns} cables${d.extras.length ? ` · ${d.extras.join(' · ')}` : ''}`],
    ['Studies', d.studies.length ? (fails ? `${fails} fail` : checks ? `${checks} to check` : 'All pass') : 'Not run', d.studies.length ? `${passes} pass · ${checks} check · ${fails} fail` : '']
  ];
  const meters = d.transformers.length
    ? `<table class="bars">${d.transformers.map((t) => `<tr><td class="bl">${esc(t.boardId)} <span class="m">${t.kva} kVA</span></td><td class="bt"><div class="track"><div class="bf" style="width:${Math.min(100, t.loadingPct).toFixed(1)}%"></div></div><div class="lim" style="left:${t.limitPct}%"></div></td><td class="bv">${f0(t.loadingPct)} %${t.status !== 'ok' ? ` <b class="${t.status}">${t.status === 'bad' ? '✕ over' : '⚠ above limit'}</b>` : ''}</td></tr>`).join('')}</table>`
    : '<p class="m">No transformer set.</p>';
  const todo = d.todo.length
    ? `<ul class="todo">${d.todo.slice(0, 9).map((t) => `<li><b class="${t.status}">${t.status === 'bad' ? '✕ Fix' : '⚠ Check'}</b> ${esc(t.text)}</li>`).join('')}${d.todo.length > 9 ? `<li class="m">+ ${d.todo.length - 9} more</li>` : ''}</ul>`
    : '<p class="ok">✓ Nothing outstanding.</p>';
  const meta = [['Owner', i.owner], ['Plot', i.plot], ['Area', i.area], ['Consultant', i.consultant], ['Engineer', i.engineer], ['Status', i.status], ['Revision', i.revision]]
    .filter(([, v]) => v).map(([k, v]) => `<span><span class="m">${esc(k!)}:</span> ${esc(v!)}</span>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — project summary</title><style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font: 9.5px/1.35 Arial, sans-serif; color: #17202e; margin: 0; }
  header { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #17202e; padding-bottom: 5px; margin-bottom: 6px; }
  header h1 { font-size: 16px; margin: 0; } header .sp { flex: 1; } .logo { max-height: 12mm; max-width: 45mm; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-bottom: 7px; }
  .m { color: #5b6b82; }
  .tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin-bottom: 7px; }
  .tile { border: 1px solid #c9d1dd; border-radius: 4px; padding: 5px 7px; }
  .tile .l { font-size: 8px; text-transform: uppercase; letter-spacing: .03em; color: #5b6b82; }
  .tile .v { font-size: 15px; font-weight: 700; margin: 1px 0; }
  .tile .s { font-size: 8.5px; color: #3d4a5c; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
  h2 { font-size: 11px; margin: 0 0 4px; border-bottom: 1px solid #1d4f8f; color: #1d4f8f; }
  .bars { width: 100%; border-collapse: collapse; }
  .bars td { padding: 1.5px 3px; vertical-align: middle; }
  .bl { width: 34%; white-space: nowrap; overflow: hidden; } .bv { width: 24%; white-space: nowrap; }
  .bt { position: relative; } .bf { height: 7px; background: #2a78d6; border-radius: 0 3px 3px 0; }
  .track { background: #dbe7f7; border-radius: 3px; }
  .lim { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1.5px dashed #17202e; }
  .todo { margin: 0; padding-left: 0; list-style: none; } .todo li { margin: 2px 0; }
  .ok { color: #13803d; } .warn { color: #a86500; } .bad { color: #c21f32; }
  footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 7.5px; color: #5b6b82; display: flex; justify-content: space-between; }
  </style></head><body>
  <header>${logo}<div><h1>${esc(i.name)}</h1><div class="m">Project summary · ${esc(revisionStamp(project))}</div></div><span class="sp"></span><div class="m">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div></header>
  <div class="meta">${meta}</div>
  <div class="tiles">${tiles.map(([l, v, s]) => `<div class="tile"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('')}</div>
  <div class="grid">
    <section><h2>Load by type (maximum demand)</h2>${bars(d.byType, 'No loads yet.')}</section>
    <section><h2>Transformer loading</h2>${meters}</section>
    <section><h2>${esc(d.perArea.title)}</h2>${bars(d.perArea.bars, 'No levels with rooms yet.')}</section>
    <section><h2>To do</h2>${todo}</section>
  </div>
  <footer><span>Generated by LV Design Studio from the design as it is — results to be checked by a qualified engineer.</span><span>${esc(project.name)}</span></footer>
  </body></html>`;
}
