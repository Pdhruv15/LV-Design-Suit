import type { Project } from '../types';
import { earthingLayout, type EarthItem, type EarthLayout } from '../model/earthingPlan';
import { mainBoards, txTag } from '../model/transformers';

/** Earthing schematic drawing (printable SVG), in the SLD drawing style.
 *
 * Earth only — no power cables. One band per substation: the substation zone
 * (each RMU and transformer with its earth conductors — RMU body; transformer
 * neutral and body, never joined — down to its pits) and its LV room (each
 * main board as an earth bar, incoming earths from the sub-boards dotted from
 * above, one conductor from the bar's centre to its pits). A wide band puts
 * the LV room on its own row. Pits of the same kind in one substation are
 * interconnected (dashed). Symbol legend and DEWA notes at the bottom. */

const PIT = 64, GREEN = '#1a7f37', MAX_W = 3200;
const BAND_H = 560; // one row: equipment, conductors, pits and links
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ln = (x1: number, y1: number, x2: number, y2: number, w = 1.3, c = '#111') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`;

/** IEC 60617 load-break switch (switch-disconnector), open, on a vertical line centred at (x, y). */
const lbs = (x: number, y: number) => `${ln(x, y + 14, x, y + 6)}${ln(x, y + 6, x - 7, y - 6)}${ln(x - 3, y - 6, x + 3, y - 6)}<circle cx="${x}" cy="${y - 6}" r="1.8" fill="#fff" stroke="#111" stroke-width="1"/>${ln(x, y - 6, x, y - 12)}`;
/** IEC 60617 fuse (rectangle with the line through it). */
const fuse = (x: number, y: number) => `<rect x="${x - 3.5}" y="${y - 7}" width="7" height="14" fill="#fff" stroke="#111" stroke-width="1.1"/>${ln(x, y - 7, x, y + 7, 1)}`;

/** RMU: two ring load-break switches and one T-off switch-fuse on a common busbar, in a dashed enclosure (110 × 66). */
export function rmuSymbol(cx: number, top: number, enclosure = true): string {
  const w = 110, h = 66, l = cx - w / 2;
  const bus = top + 18;
  const xs = [cx - 34, cx, cx + 34];
  let s = enclosure ? `<rect x="${l}" y="${top}" width="${w}" height="${h}" fill="#fff" stroke="#111" stroke-width="1.2" stroke-dasharray="5 2"/>` : '';
  s += ln(xs[0], bus, xs[2], bus, 2);
  for (const x of xs) s += ln(x, bus, x, bus + 8);
  s += lbs(xs[0], bus + 20) + ln(xs[0], bus + 34, xs[0], top + h);
  s += lbs(xs[1], bus + 20) + ln(xs[1], bus + 34, xs[1], top + h);
  s += lbs(xs[2], bus + 20) + fuse(xs[2], bus + 41) + ln(xs[2], bus + 48, xs[2], top + h);
  return s;
}

/** Transformer: two overlapping circles (r). */
const txSymbol = (cx: number, cy: number, r = 13) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#111" stroke-width="1.3"/><circle cx="${cx}" cy="${cy + r * 1.4}" r="${r}" fill="none" stroke="#111" stroke-width="1.3"/>`;
/** Earth pit: inspection pit (hollow square) and electrode (earth symbol); the conductor runs through. */
const pitSymbol = (x: number, y: number) => `<rect x="${x - 7}" y="${y}" width="14" height="10" fill="none" stroke="#111" stroke-width="1.3"/>${ln(x - 7, y + 28, x + 7, y + 28)}${ln(x - 4.5, y + 31, x + 4.5, y + 31)}${ln(x - 2, y + 34, x + 2, y + 34)}`;

export function earthingDrawing(project: Project, L: EarthLayout = earthingLayout(project)): { svg: string; w: number; h: number } {
  const out: string[] = [];
  const pitX = new Map<string, number>(), pitY = new Map<string, number>();
  const pitsOf = (it: EarthItem) => L.pits.filter((p) => p.itemKey === it.key);
  const mm = L.conductorMm2;
  const txBoards = mainBoards(project).filter((b) => b.sourceKva);

  /** Conductor from (cx, y0) down to the item's pits (row at py), with a bus when there are several. */
  const drop = (it: EarthItem, cx: number, y0: number, py: number, label: string) => {
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
  const place = (it: EarthItem, from: number, width: number, py: number) => {
    const ps = pitsOf(it);
    const mid = from + width / 2;
    ps.forEach((p, i) => { pitX.set(p.id, mid + (i - (ps.length - 1) / 2) * PIT); pitY.set(p.id, py); });
    return mid;
  };
  const zone = (x: number, y: number, w: number, label: string) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${BAND_H - 40}" fill="none" stroke="#999" stroke-dasharray="4 3"/><text x="${x + 8}" y="${y + 14}" font-size="8" font-weight="bold">${esc(label)}</text>`);

  // Widths, to decide whether a substation's LV room fits beside it.
  const rmuW = (it: EarthItem) => Math.max(150, pitsOf(it).length * PIT) + 20;
  const lvW = (it: EarthItem) => Math.max(220, pitsOf(it).length * PIT) + 20;

  let y = 50, right = 0;
  const groups = [...new Set(L.items.map((i) => i.group))];
  for (const g of groups) {
    const rmus = L.items.filter((i) => i.group === g && i.kind === 'rmu');
    const txs = txBoards.filter((b) => L.items.some((i) => i.key === `txn:${b.id}` && i.group === g));
    const lvs = L.items.filter((i) => i.group === g && (i.kind === 'lv' || (i.kind === 'sub' && i.pits > 0)));
    const lvWidth = lvs.reduce((s, i) => s + lvW(i), 0) + 40;
    const name = g.toUpperCase();

    // ---- Substation zone ----------------------------------------------------
    let x = 60;
    const TOP = y, PY = y + 410;
    if (rmus.length || txs.length) {
      for (const r of rmus) {
        const w = rmuW(r) - 20, cx = place(r, x, w, PY);
        const fed = txs.filter((b) => (b.rmu?.trim() || `RMU (${txTag(project, b.id)})`) === r.equipment).map((b) => txTag(project, b.id));
        out.push(rmuSymbol(cx, TOP + 50));
        out.push(`<text x="${cx}" y="${TOP + 42}" text-anchor="middle" font-weight="bold">${esc(r.equipment)}</text><text x="${cx}" y="${TOP + 130}" text-anchor="middle" font-size="8">feeds ${esc(fed.join(', ') || '—')}</text>`);
        // Body earth from the enclosure's lower left corner
        out.push(`<path d="M${cx - 55} ${TOP + 110} H${cx - 64}" stroke="${GREEN}" stroke-width="1.6" fill="none"/>`);
        drop(r, cx - 64, TOP + 110, PY, `RMU BODY · 1C ${mm} mm² CU/PVC`);
        x += w + 20;
      }
      for (const b of txs) {
        const n = L.items.find((i) => i.key === `txn:${b.id}`)!, bd = L.items.find((i) => i.key === `txb:${b.id}`)!;
        const wn = Math.max(80, pitsOf(n).length * PIT), wb = Math.max(80, pitsOf(bd).length * PIT);
        const nx = place(n, x, wn, PY), bx = place(bd, x + wn, wb, PY);
        const cx = (nx + bx) / 2, cy = TOP + 80;
        out.push(txSymbol(cx, cy));
        out.push(`<text x="${cx}" y="${cy - 22}" text-anchor="middle" font-weight="bold">${esc(txTag(project, b.id) ?? b.id)}</text><text x="${cx}" y="${cy - 34}" text-anchor="middle" font-size="8">${b.sourceKva} kVA · ${esc(b.vectorGroup ?? 'Dyn11')}</text>`);
        out.push(`<path d="M${cx - 13} ${cy + 18} H${nx}" stroke="${GREEN}" stroke-width="1.6" fill="none"/><path d="M${cx + 13} ${cy + 18} H${bx}" stroke="${GREEN}" stroke-width="1.6" fill="none"/>`);
        drop(n, nx, cy + 18, PY, `${txTag(project, b.id)} NEUTRAL · 1C ${mm} mm²`);
        drop(bd, bx, cy + 18, PY, `${txTag(project, b.id)} BODY · 1C ${mm} mm²`);
        x += wn + wb + 20;
      }
      zone(40, TOP, x - 40, name);
    }

    // ---- LV room: beside the substation, or on its own row when too wide -----
    let LT = TOP, lvStart = x === 60 ? 40 : x + 10;
    if (x > 60 && x + lvWidth > MAX_W) { right = Math.max(right, x); y += BAND_H; LT = y; lvStart = 40; }
    const LP = LT + 410;
    x = lvStart + 20;
    for (const it of lvs) {
      const w = lvW(it) - 20, cx = place(it, x, w, LP);
      const by = LT + 190, bl = cx - 85, br = cx + 85;
      out.push(`<text x="${bl}" y="${LT + 95}" fill="${GREEN}" font-size="8">EARTH / CPC FROM ${it.kind === 'sub' ? 'DBs' : 'SMDBs, DBs'}</text>`);
      for (const ax of [bl + 12, bl + 34, bl + 56, br - 34, br - 12]) out.push(`<path d="M${ax} ${LT + 105} V${by - 6}" stroke="${GREEN}" stroke-width="1.2" stroke-dasharray="2 3" fill="none" marker-end="url(#ea)"/>`);
      out.push(`<text x="${(bl + 56 + br - 34) / 2}" y="${LT + 150}" text-anchor="middle" fill="${GREEN}">…</text>`);
      out.push(`${ln(bl, by, br, by, 5)}<text x="${cx + 8}" y="${by + 18}" font-weight="bold">${esc(it.equipment)} EARTH BAR</text>`);
      drop(it, cx, by, LP, `1C ${mm} mm² CU/PVC`);
      x += w + 20;
    }
    if (lvs.length) zone(lvStart, LT, x - lvStart, groups.length > 1 ? `LV ROOM — ${name}` : 'LV ROOM');
    right = Math.max(right, x);
    y += BAND_H;
  }

  // ---- Pit interconnections: same kind, same substation; dashed, one depth per kind ----
  const depth: Record<string, number> = { rmu: 50, txn: 50, txb: 64, lv: 50, sub: 64 };
  const kindOf = new Map(L.pits.map((p) => [p.id, p.kind]));
  const ownPair = new Set(L.items.flatMap((it) => { const ids = pitsOf(it).map((p) => p.id); return ids.slice(1).map((id, i) => `${ids[i]}|${id}`); }));
  for (const [a, b] of L.links) {
    if (ownPair.has(`${a}|${b}`) || !pitX.has(a) || !pitX.has(b)) continue;
    const ax = pitX.get(a)!, bx = pitX.get(b)!, py = pitY.get(a)!, d = py + depth[kindOf.get(a)!];
    out.push(`<path d="M${ax} ${py + 34} V${d} H${bx} V${py + 34}" stroke="${GREEN}" stroke-width="1.6" stroke-dasharray="6 3" fill="none"/>`);
  }
  for (const p of L.pits) {
    if (!pitX.has(p.id)) continue;
    const px = pitX.get(p.id)!, py = pitY.get(p.id)!;
    out.push(`${pitSymbol(px, py)}<text x="${px + 10}" y="${py + 9}" font-weight="bold">${p.id}</text>${p.measured !== undefined ? `<text x="${px + 10}" y="${py + 22}" font-size="8">${p.measured} Ω</text>` : ''}`);
  }

  // ---- Legend and notes -------------------------------------------------------
  const ly = y + 10, lx = 40;
  const rows: [string, string, number][] = [
    [`<g transform="translate(26 -16) scale(.5)">${rmuSymbol(0, 0)}</g>`, 'RMU: 2 × ring load-break switch + 1 × T-off switch-fuse (IEC 60617)', 44],
    [`<g transform="translate(26 -10)">${txSymbol(0, 0, 7)}</g>`, 'Transformer', 30],
    [ln(8, 0, 44, 0, 5), 'Earth bar (main board / SMDB)', 26],
    [`<path d="M8 0 H44" stroke="${GREEN}" stroke-width="1.6"/>`, `Earth conductor 1C ${mm} mm² CU/PVC`, 26],
    [`<path d="M8 0 H44" stroke="${GREEN}" stroke-width="1.6" stroke-dasharray="6 3"/>`, 'Pit interconnection (same kind, same substation)', 26],
    [`<path d="M8 0 H42" stroke="${GREEN}" stroke-width="1.2" stroke-dasharray="2 3" marker-end="url(#ea)"/>`, 'Incoming earth / CPC from sub-boards (indicative)', 26],
    [`<g transform="translate(26 -16)">${pitSymbol(0, 0)}</g>`, `Earth pit: inspection pit with min. ${L.electrodeM} m Cu-bonded electrode`, 40]
  ];
  let ry = 34;
  let legendBody = '';
  for (const [sym, text, rh] of rows) { const cy = ry + rh / 2; legendBody += `<g transform="translate(10 ${cy})">${sym}</g><text x="70" y="${cy + 3}" font-size="9">${esc(text)}</text>`; ry += rh; }
  const legendH = ry + 8;
  const legend = `<g transform="translate(${lx} ${ly})"><rect x="0" y="0" width="520" height="${legendH}" fill="#fff" stroke="#111"/><text x="10" y="18" font-weight="bold">LEGEND</text>${ln(0, 24, 520, 24, 0.6)}${legendBody}</g>`;
  const notes = [
    'NOTES',
    '1. RMU, TRANSFORMER NEUTRAL, TRANSFORMER BODY AND LV EARTHS ARE SEPARATE SYSTEMS.',
    '2. TRANSFORMER NEUTRAL AND BODY EARTHS ARE NOT INTERCONNECTED.',
    '3. EARTH PITS OF DIFFERENT SUBSTATIONS ARE NOT INTERCONNECTED.',
    '4. SUBSTATION EARTHS < 2 Ω; LV EARTH ≤ 1 Ω PER INCOMING SUPPLY / MDB (DEWA).',
    '5. EARTH PITS AT LEAST 6.0 m APART. LIGHTNING PROTECTION NOT SHOWN.'
  ];
  const noteSvg = `<g transform="translate(${lx + 560} ${ly})">${notes.map((t, i) => `<text x="0" y="${18 + i * 16}" font-size="9"${i ? '' : ' font-weight="bold"'}>${esc(t)}</text>`).join('')}</g>`;

  const w = Math.max(right + 30, 1300), h = ly + legendH + 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial" font-size="10" fill="#111">
  <defs><marker id="ea" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1L10,5L0,9z" fill="${GREEN}"/></marker></defs>
  <rect width="${w}" height="${h}" fill="#fff"/>
  <text x="${w / 2}" y="30" text-anchor="middle" font-size="14" font-weight="bold">EARTHING SCHEMATIC DIAGRAM</text>
  ${out.join('\n')}
  ${legend}
  ${noteSvg}
</svg>`;
  return { svg, w, h };
}
