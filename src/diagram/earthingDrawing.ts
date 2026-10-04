import type { Project } from '../types';
import { earthingLayout, type EarthItem, type EarthLayout } from '../model/earthingPlan';
import { mainBoards, txTag } from '../model/transformers';

/** Earthing schematic drawing (printable SVG), in the SLD drawing style.
 *
 * Earth only — no power cables. Substation: each RMU and transformer with its
 * earth conductors (RMU body; transformer neutral and body, never joined) down
 * to its pits. LV room: each main board as an earth bar, incoming earths from
 * the sub-boards dotted from above, one conductor from the bar's centre to its
 * pits. Pits of the same kind are interconnected (dashed). */

const PIT = 64, PY = 470, TOP = 60;
const GREEN = '#1a7f37';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function earthingDrawing(project: Project, L: EarthLayout = earthingLayout(project)): { svg: string; w: number; h: number } {
  const out: string[] = [];
  const pitX = new Map<string, number>();
  const pitY = new Map<string, number>(); // pit row (PY of its section)
  const pitsOf = (it: EarthItem) => L.pits.filter((p) => p.itemKey === it.key);
  const mm = L.conductorMm2;
  let x = 40;

  /** Conductor from (cx, y0) down to the item's pits, with a bus when there are several. */
  const drop = (it: EarthItem, cx: number, y0: number, label: string, py = PY) => {
    const ps = pitsOf(it);
    if (!ps.length) { out.push(`<text x="${cx}" y="${py}" text-anchor="middle" fill="#c0392b" font-weight="bold">NO PIT</text>`); return; }
    const xs = ps.map((p) => pitX.get(p.id)!);
    const bus = py - 18;
    const straight = xs.length === 1 && Math.abs(xs[0] - cx) < 0.5;
    out.push(`<path d="M${cx} ${y0} V${straight ? py + 28 : bus}" stroke="${GREEN}" stroke-width="1.6" fill="none"/>`);
    if (!straight) {
      out.push(`<path d="M${Math.min(cx, ...xs)} ${bus} H${Math.max(cx, ...xs)}" stroke="${GREEN}" stroke-width="1.6" fill="none"/>`);
      for (const px of xs) out.push(`<path d="M${px} ${bus} V${py + 28}" stroke="${GREEN}" stroke-width="1.6" fill="none"/>`);
    }
    const ty = (y0 + bus) / 2;
    out.push(`<text x="${cx - 9}" y="${ty}" text-anchor="middle" fill="${GREEN}" font-size="8" transform="rotate(-90 ${cx - 9} ${ty})">${esc(label)}</text>`);
  };

  const place = (it: EarthItem, from: number, width: number, py = PY) => {
    const ps = pitsOf(it);
    const mid = from + width / 2;
    ps.forEach((p, i) => { pitX.set(p.id, mid + (i - (ps.length - 1) / 2) * PIT); pitY.set(p.id, py); });
    return mid;
  };

  // ---- Substation: RMUs, then transformers -----------------------------------
  const rmus = L.items.filter((i) => i.kind === 'rmu');
  const txIds = mainBoards(project).filter((b) => b.sourceKva).map((b) => b.id);
  const subStart = x;
  for (const r of rmus) {
    const w = Math.max(150, pitsOf(r).length * PIT);
    const cx = place(r, x, w);
    const fed = txIds.filter((id) => (project.boards.find((b) => b.id === id)!.rmu?.trim() || `RMU (${txTag(project, id)})`) === r.equipment).map((id) => txTag(project, id));
    out.push(`<rect x="${cx - 60}" y="${TOP + 60}" width="120" height="40" fill="#fff" stroke="#111" stroke-width="1.3"/><text x="${cx}" y="${TOP + 77}" text-anchor="middle" font-weight="bold">${esc(r.equipment)}</text><text x="${cx}" y="${TOP + 91}" text-anchor="middle" font-size="8">feeds ${esc(fed.join(', ') || '—')}</text>`);
    drop(r, cx - 40, TOP + 100, `RMU BODY · 1C ${mm} mm² CU/PVC`);
    x += w + 20;
  }
  for (const id of txIds) {
    const n = L.items.find((i) => i.key === `txn:${id}`)!, b = L.items.find((i) => i.key === `txb:${id}`)!;
    const wn = Math.max(80, pitsOf(n).length * PIT), wb = Math.max(80, pitsOf(b).length * PIT);
    const nx = place(n, x, wn), bx = place(b, x + wn, wb);
    const cx = (nx + bx) / 2, cy = TOP + 80;
    const tx = project.boards.find((q) => q.id === id)!;
    out.push(`<circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="#111" stroke-width="1.3"/><circle cx="${cx}" cy="${cy + 18}" r="13" fill="none" stroke="#111" stroke-width="1.3"/>`);
    out.push(`<text x="${cx}" y="${cy - 22}" text-anchor="middle" font-weight="bold">${esc(txTag(project, id) ?? id)}</text><text x="${cx}" y="${cy - 34}" text-anchor="middle" font-size="8">${tx.sourceKva} kVA · ${esc(tx.vectorGroup ?? 'Dyn11')}</text>`);
    out.push(`<path d="M${cx - 13} ${cy + 18} H${nx}" stroke="${GREEN}" stroke-width="1.6" fill="none"/><path d="M${cx + 13} ${cy + 18} H${bx}" stroke="${GREEN}" stroke-width="1.6" fill="none"/>`);
    drop(n, nx, cy + 18, `${txTag(project, id)} NEUTRAL · 1C ${mm} mm²`);
    drop(b, bx, cy + 18, `${txTag(project, id)} BODY · 1C ${mm} mm²`);
    x += wn + wb + 20;
  }
  if (x > subStart) out.push(`<rect x="${subStart - 20}" y="${TOP}" width="${x - subStart}" height="${PY - TOP + 90}" fill="none" stroke="#999" stroke-dasharray="4 3"/><text x="${subStart - 12}" y="${TOP + 14}" font-size="8" font-weight="bold">SUBSTATION</text>`);

  // ---- LV room: main board earth bars, then SMDBs with their own pits -------
  // A wide site (many transformers) puts the LV room on a second row.
  const subEnd = x;
  const lvItems = L.items.filter((i) => (i.kind === 'lv' || i.kind === 'sub') && (i.kind === 'lv' || i.pits > 0));
  const lvWidth = lvItems.reduce((s2, it) => s2 + Math.max(220, pitsOf(it).length * PIT) + 20, 40);
  const ROW = PY - TOP + 150;
  const stacked = subEnd > 60 && subEnd + lvWidth > 2400;
  const dy = stacked ? ROW : 0;
  const T = TOP + dy, P = PY + dy;
  const lvStart = stacked ? 20 : x + 10;
  x = lvStart + 20;
  for (const it of lvItems) {
    const w = Math.max(220, pitsOf(it).length * PIT);
    const cx = place(it, x, w, P);
    const by = T + 190, bl = cx - 85, br = cx + 85;
    out.push(`<text x="${bl}" y="${T + 95}" fill="${GREEN}" font-size="8">EARTH / CPC FROM ${it.kind === 'sub' ? 'DBs' : 'SMDBs, DBs'}</text>`);
    for (const ax of [bl + 12, bl + 34, bl + 56, br - 34, br - 12]) out.push(`<path d="M${ax} ${T + 105} V${by - 6}" stroke="${GREEN}" stroke-width="1.2" stroke-dasharray="2 3" fill="none" marker-end="url(#ea)"/>`);
    out.push(`<text x="${(bl + 56 + br - 34) / 2}" y="${T + 150}" text-anchor="middle" fill="${GREEN}">…</text>`);
    out.push(`<line x1="${bl}" y1="${by}" x2="${br}" y2="${by}" stroke="#111" stroke-width="5"/><text x="${cx + 8}" y="${by + 18}" font-weight="bold">${esc(it.equipment)} EARTH BAR</text>`);
    drop(it, cx, by, `1C ${mm} mm² CU/PVC`, P);
    x += w + 20;
  }
  const lvW = x - lvStart;
  if (lvItems.length) out.push(`<rect x="${lvStart}" y="${T}" width="${lvW}" height="${PY - TOP + 90}" fill="none" stroke="#999" stroke-dasharray="4 3"/><text x="${lvStart + 8}" y="${T + 14}" font-size="8" font-weight="bold">LV ROOM</text>`);
  const right = Math.max(subEnd, x);

  // ---- Pit interconnections: same kind only, dashed, one depth per kind -------
  const depth: Record<string, number> = { rmu: 50, txn: 50, txb: 64, lv: 50, sub: 64 };
  const kindOf = new Map(L.pits.map((p) => [p.id, p.kind]));
  const own = new Set(L.items.flatMap((it) => { const ids = pitsOf(it).map((p) => p.id); return ids.slice(1).map((id, i) => `${ids[i]}|${id}`); }));
  for (const [a, b] of L.links) {
    if (own.has(`${a}|${b}`)) continue; // pits of one equipment already share its bus
    if (!pitX.has(a) || !pitX.has(b)) continue;
    const ax = pitX.get(a)!, bx = pitX.get(b)!, py = pitY.get(a)!, d = py + depth[kindOf.get(a)!];
    out.push(`<path d="M${ax} ${py + 34} V${d} H${bx} V${py + 34}" stroke="${GREEN}" stroke-width="1.6" stroke-dasharray="6 3" fill="none"/>`);
  }

  // ---- Pits ---------------------------------------------------------------------
  for (const p of L.pits) {
    if (!pitX.has(p.id)) continue;
    const px = pitX.get(p.id)!, py = pitY.get(p.id)!;
    out.push(`<rect x="${px - 7}" y="${py}" width="14" height="10" fill="none" stroke="#111" stroke-width="1.3"/><line x1="${px - 7}" y1="${py + 28}" x2="${px + 7}" y2="${py + 28}" stroke="#111" stroke-width="1.3"/><line x1="${px - 4.5}" y1="${py + 31}" x2="${px + 4.5}" y2="${py + 31}" stroke="#111" stroke-width="1.3"/><line x1="${px - 2}" y1="${py + 34}" x2="${px + 2}" y2="${py + 34}" stroke="#111" stroke-width="1.3"/>`);
    out.push(`<text x="${px + 10}" y="${py + 9}" font-weight="bold">${p.id}</text>${p.measured !== undefined ? `<text x="${px + 10}" y="${py + 22}" font-size="8">${p.measured} Ω</text>` : ''}`);
  }

  const w = Math.max(right + 20, 900), h = P + 170;
  const notes = [
    'RMU, TRANSFORMER NEUTRAL, TRANSFORMER BODY AND LV EARTHS ARE SEPARATE SYSTEMS — NEUTRAL AND BODY EARTHS NOT INTERCONNECTED.',
    `SUBSTATION EARTHS < 2 Ω · LV EARTH ≤ 1 Ω PER INCOMING SUPPLY / MDB (DEWA) · EARTH PITS ≥ 6.0 m APART · MIN. ${L.electrodeM} m Cu-BONDED ELECTRODE IN INSPECTION PIT.`
  ];
  const ly = P + 100;
  const legend = `<g transform="translate(40,${ly})" font-size="8">
    <line x1="0" y1="5" x2="30" y2="5" stroke="${GREEN}" stroke-width="1.6"/><text x="36" y="8">earth conductor 1C ${mm} mm² CU/PVC</text>
    <line x1="210" y1="5" x2="240" y2="5" stroke="${GREEN}" stroke-width="1.6" stroke-dasharray="6 3"/><text x="246" y="8">pit interconnection (same kind)</text>
    <line x1="410" y1="5" x2="440" y2="5" stroke="${GREEN}" stroke-width="1.2" stroke-dasharray="2 3" marker-end="url(#ea)"/><text x="446" y="8">incoming earth / CPC from sub-boards (indicative)</text>
    <line x1="670" y1="5" x2="700" y2="5" stroke="#111" stroke-width="5"/><text x="706" y="8">earth bar</text>
    ${notes.map((t, i) => `<text x="0" y="${28 + i * 12}">${esc(t)}</text>`).join('')}
  </g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial" font-size="10" fill="#111">
  <defs><marker id="ea" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1L10,5L0,9z" fill="${GREEN}"/></marker></defs>
  <rect width="${w}" height="${h}" fill="#fff"/>
  <text x="${w / 2}" y="30" text-anchor="middle" font-size="14" font-weight="bold">EARTHING SCHEMATIC DIAGRAM</text>
  ${out.join('\n')}
  ${legend}
</svg>`;
  return { svg, w, h };
}
