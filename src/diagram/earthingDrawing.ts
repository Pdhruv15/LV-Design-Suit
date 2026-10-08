import type { Project } from '../types';
import { earthingLayout, kindInfo, type EarthItem, type EarthLayout } from '../model/earthingPlan';
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
/** A substation row wraps before this width, so the drawing still prints readably on one sheet. */
const SUB_MAX_W = 2900;
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
/** Earth bar (copper, with studs) and its ID; the conductor to the pits leaves from the centre through a test link. */
const BAR_W = 64, CU = '#b86b2b', TAG = '#1d4f8f';
const earthBar = (cx: number, y: number, id: string, w = BAR_W) => {
  let s = `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="10" rx="2" fill="${CU}" fill-opacity="0.18" stroke="${CU}" stroke-width="1.3"/>`;
  for (let i = 0, n = Math.floor((w - 8) / 14); i < n; i++) s += `<circle cx="${cx - w / 2 + 11 + i * 14}" cy="${y + 5}" r="2.4" fill="#111"/>`;
  return s + idTag(cx + 6, y + 24, id);
};
/** An ID in a rounded outline (earth bars), starting at x. */
const idTag = (x: number, y: number, id: string) => {
  const w = 10 + id.length * 5.6;
  return `<rect x="${x}" y="${y - 10}" width="${w}" height="14" rx="7" fill="#fff" stroke="${TAG}" stroke-width="0.8"/><text x="${x + w / 2}" y="${y + 1}" text-anchor="middle" font-size="8.5" font-weight="bold" fill="${TAG}">${esc(id)}</text>`;
};
/** Test link on a vertical conductor at (x, y): a box the conductor passes through, marked TL. */
const testLink = (x: number, y: number) => `<rect x="${x - 6}" y="${y - 5}" width="12" height="10" fill="#fff" stroke="#111" stroke-width="1"/>${ln(x - 6, y, x + 6, y, 1)}<text x="${x - 9}" y="${y + 3}" text-anchor="end" font-size="7" fill="#5b6b82">TL</text>`;
/** Conductor size on a vertical conductor: a tick and the size beside it (horizontal, readable). */
const callout = (x: number, y: number, label: string) => `${ln(x - 4, y + 4, x + 4, y - 4, 1.2, GREEN)}<text x="${x + 7}" y="${y + 3}" font-size="8" fill="${GREEN}">${esc(label)}</text>`;
/** Filled arrowhead with its tip at (x, y), pointing up / left. */
const headUp = (x: number, y: number) => `<path d="M${x - 3.5} ${y + 8} L${x} ${y} L${x + 3.5} ${y + 8} Z" fill="${GREEN}"/>`;
const headLeft = (x: number, y: number) => `<path d="M${x + 8} ${y - 3.5} L${x} ${y} L${x + 8} ${y + 3.5} Z" fill="${GREEN}"/>`;
/** Words wrapped to lines of at most `max` characters. */
const wrapText = (text: string, max: number) => text.split(' ').reduce<string[]>((lines, w) => {
  const last = lines[lines.length - 1];
  if (last !== undefined && (last + ' ' + w).length <= max) lines[lines.length - 1] = `${last} ${w}`;
  else lines.push(w);
  return lines;
}, []);
/** Dimension line between two pits with its text above. */
const separation = (x1: number, x2: number, y: number, label: string) =>
  `${ln(x1, y, x2, y, 0.7, '#5b6b82')}${ln(x1, y - 4, x1, y + 4, 0.7, '#5b6b82')}${ln(x2, y - 4, x2, y + 4, 0.7, '#5b6b82')}<text x="${(x1 + x2) / 2}" y="${y - 4}" text-anchor="middle" font-size="8" fill="#5b6b82">${esc(label)}</text>`;

/** Earth pit: inspection pit (hollow square) and electrode (earth symbol); the conductor runs through. */
const pitSymbol = (x: number, y: number) => `<rect x="${x - 7}" y="${y}" width="14" height="10" fill="none" stroke="#111" stroke-width="1.3"/>${ln(x - 7, y + 28, x + 7, y + 28)}${ln(x - 4.5, y + 31, x + 4.5, y + 31)}${ln(x - 2, y + 34, x + 2, y + 34)}`;

export function earthingDrawing(project: Project, L: EarthLayout = earthingLayout(project), includeSchedule = true): { svg: string; w: number; h: number } {
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
    out.push(callout(cx, ty, label));
  };
  // Earth bar IDs, numbered in drawing order: EB-RMU-01 …, and each transformer's EB-TX(N)-nn / EB-TX(B)-nn.
  const two = (n: number) => String(n).padStart(2, '0');
  const barId = new Map<string, string>();
  L.items.filter((i) => i.kind === 'rmu').forEach((i, n) => barId.set(i.key, `EB-RMU-${two(n + 1)}`));
  txBoards.forEach((b, n) => { barId.set(`txn:${b.id}`, `EB-TX(N)-${two(n + 1)}`); barId.set(`txb:${b.id}`, `EB-TX(B)-${two(n + 1)}`); });
  /** Equipment → earth bar → test link → pits; the size called out on the conductor to the pits. */
  const BAR_Y = 190;
  const viaBar = (it: EarthItem, cx: number, from: string, top: number, py: number) => {
    const by = top + BAR_Y;
    out.push(`<path d="${from} V${by}" stroke="${GREEN}" stroke-width="1.6" fill="none"/>`, earthBar(cx, by, barId.get(it.key) ?? 'EB'));
    out.push(`<path d="M${cx} ${by + 10} V${by + 52}" stroke="${GREEN}" stroke-width="1.6" fill="none"/>`, testLink(cx, by + 46));
    drop(it, cx, by + 52, py, `1C ${mm} mm² Cu G/Y`);
  };
  /** "≥ 6 m" between the first and last pit of one item, at depth dy below the pits. */
  const spread = (it: EarthItem, py: number, dy: number) => {
    const xs = pitsOf(it).map((p) => pitX.get(p.id)!);
    if (xs.length > 1) out.push(separation(Math.min(...xs), Math.max(...xs), py + dy, '≥ 6 m'));
  };
  const place = (it: EarthItem, from: number, width: number, py: number) => {
    const ps = pitsOf(it);
    const mid = from + width / 2;
    ps.forEach((p, i) => { pitX.set(p.id, mid + (i - (ps.length - 1) / 2) * PIT); pitY.set(p.id, py); });
    return mid;
  };
  const zone = (x: number, y: number, w: number, label: string) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${BAND_H - 40}" fill="none" stroke="#999" stroke-dasharray="4 3"/><text x="${x + 8}" y="${y + 14}" font-size="8" font-weight="bold">${esc(label)}</text>`);

  // Widths, to decide whether a substation's LV room fits beside it.
  const rmuW = (it: EarthItem) => Math.max(160, pitsOf(it).length * PIT) + 20;
  const lvW = (it: EarthItem) => Math.max(300, pitsOf(it).length * PIT) + 20;

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
    let TOP = y, PY = y + 410;
    // A substation wider than the sheet continues on the next row (each row its own zone).
    const wrap = (w: number) => {
      if (x === 60 || x + w <= SUB_MAX_W) return;
      zone(40, TOP, x - 40, name);
      right = Math.max(right, x);
      y += BAND_H; TOP = y; PY = y + 410; x = 60;
    };
    if (rmus.length || txs.length) {
      for (const r of rmus) {
        wrap(rmuW(r));
        const w = rmuW(r) - 20, cx = place(r, x, w, PY);
        const fed = txs.filter((b) => (b.rmu?.trim() || `RMU (${txTag(project, b.id)})`) === r.equipment).map((b) => txTag(project, b.id));
        out.push(rmuSymbol(cx, TOP + 50));
        out.push(`<text x="${cx}" y="${TOP + 42}" text-anchor="middle" font-weight="bold">${esc(r.equipment)}</text><text x="${cx}" y="${TOP + 130}" text-anchor="middle" font-size="8">feeds ${esc(fed.join(', ') || '—')}</text>`);
        // Body earth from the enclosure's lower left corner, to its earth bar
        out.push(`<path d="M${cx - 55} ${TOP + 110} H${cx - 64}" stroke="${GREEN}" stroke-width="1.6" fill="none"/><circle cx="${cx - 55}" cy="${TOP + 110}" r="2.5" fill="${GREEN}"/>`);
        viaBar(r, cx - 64, `M${cx - 64} ${TOP + 110}`, TOP, PY);
        spread(r, PY, 84);
        x += w + 20;
      }
      for (const b of txs) {
        const n = L.items.find((i) => i.key === `txn:${b.id}`)!, bd = L.items.find((i) => i.key === `txb:${b.id}`)!;
        const wn = Math.max(100, pitsOf(n).length * PIT), wb = Math.max(100, pitsOf(bd).length * PIT);
        wrap(wn + wb + 20);
        const nx = place(n, x, wn, PY), bx = place(bd, x + wn, wb, PY);
        const cx = (nx + bx) / 2, cy = TOP + 80;
        out.push(txSymbol(cx, cy));
        out.push(`<text x="${cx}" y="${cy - 22}" text-anchor="middle" font-weight="bold">${esc(txTag(project, b.id) ?? b.id)}</text><text x="${cx}" y="${cy - 34}" text-anchor="middle" font-size="8">${b.sourceKva} kVA · ${esc(b.vectorGroup ?? 'Dyn11')}</text>`);
        out.push(`<text x="${nx}" y="${cy + 12}" text-anchor="middle" font-size="8" fill="#5b6b82">star point (N)</text><text x="${bx}" y="${cy + 12}" text-anchor="middle" font-size="8" fill="#5b6b82">tank / body</text>`);
        viaBar(n, nx, `M${cx - 13} ${cy + 18} H${nx}`, TOP, PY);
        viaBar(bd, bx, `M${cx + 13} ${cy + 18} H${bx}`, TOP, PY);
        spread(n, PY, 84);
        spread(bd, PY, 84);
        // Neutral and body pit groups kept apart (never joined)
        const nLast = Math.max(...pitsOf(n).map((p) => pitX.get(p.id)!)), bFirst = Math.min(...pitsOf(bd).map((p) => pitX.get(p.id)!));
        if (pitsOf(n).length && pitsOf(bd).length) out.push(separation(nLast, bFirst, PY + 100, '≥ 6 m  N ↔ body'));
        x += wn + wb + 20;
      }
      zone(40, TOP, x - 40, name);
    }

    // ---- LV room: beside the substation, or on its own row when too wide -----
    let LT = TOP, lvStart = x === 60 ? 40 : x + 10;
    if (x > 60 && x + lvWidth > MAX_W) { right = Math.max(right, x); y += BAND_H; LT = y; lvStart = 40; }
    let LP = LT + 410;
    x = lvStart + 20;
    const lvTitle = groups.length > 1 ? `LV ROOM — ${name}` : 'LV ROOM';
    for (const it of lvs) {
      // A long LV room continues on the next row, like the substation.
      if (x > lvStart + 20 && x + lvW(it) > SUB_MAX_W) { zone(lvStart, LT, x - lvStart, lvTitle); right = Math.max(right, x); y += BAND_H; LT = y; LP = LT + 410; lvStart = 40; x = 60; }
      const w = lvW(it) - 20, cx = place(it, x, w, LP);
      const main = it.kind === 'lv';
      // The board: its N and E bars, and the single N–E link (main boards only; TN-S).
      const bx = cx - 105, eY = LT + (main ? 104 : 84);
      out.push(`<rect x="${bx}" y="${LT + 46}" width="210" height="${main ? 84 : 64}" fill="#fff" stroke="#111" stroke-width="1.4"/><text x="${bx}" y="${LT + 40}" font-weight="bold">${esc(it.equipment)}</text>`);
      if (main) {
        out.push(`${ln(bx + 22, LT + 70, bx + 196, LT + 70, 2.6)}<text x="${bx + 12}" y="${LT + 74}" text-anchor="middle" font-weight="bold">N</text>`);
        out.push(`${ln(cx - 45, LT + 70, cx - 45, eY, 1.6)}<circle cx="${cx - 45}" cy="${LT + 70}" r="3" fill="#111"/><circle cx="${cx - 45}" cy="${eY}" r="3" fill="#111"/><text x="${cx - 39}" y="${LT + 90}" font-size="8" fill="#5b6b82">N–E link (only here)</text>`);
      } else out.push(`<text x="${bx + 196}" y="${LT + 64}" text-anchor="end" font-size="8" fill="#5b6b82">no N–E link (TN-S)</text>`);
      out.push(`${ln(bx + 22, eY, bx + 196, eY, 2.6, GREEN)}<text x="${bx + 12}" y="${eY + 4}" text-anchor="middle" font-weight="bold" fill="${GREEN}">E</text>`);
      // Board E bar → main earth bar → test link → pits.
      const by = LT + 236, mx = cx + 70;
      out.push(`<circle cx="${mx}" cy="${eY}" r="3" fill="${GREEN}"/><path d="M${mx} ${eY} V${by}" stroke="${GREEN}" stroke-width="1.6" fill="none"/>`, callout(mx, (eY + by) / 2 + 20, `1C ${mm} mm² Cu G/Y`));
      out.push(earthBar(cx, by, `EB-LV-${it.equipment}`, 160), `<text x="${cx - 8}" y="${by + 28}" text-anchor="end">${main ? 'MAIN EARTH BAR' : 'EARTH BAR'}</text>`);
      out.push(`<path d="M${cx} ${by + 10} V${by + 52}" stroke="${GREEN}" stroke-width="1.6" fill="none"/>`, testLink(cx, by + 46));
      drop(it, cx, by + 52, LP, `1C ${mm} mm² Cu G/Y`);
      // Bonding of metal parts (main boards): arrows up from the bar under a brace, the parts listed above.
      if (main && L.bonding.length) {
        const n = Math.min(L.bonding.length, 6), x0 = cx - 72, top = by - 34;
        for (let i = 0; i < n; i++) out.push(`<path d="M${x0 + i * 9} ${by} V${top + 6}" stroke="${GREEN}" stroke-width="1.2" fill="none"/>`, headUp(x0 + i * 9, top));
        out.push(`<path d="M${x0 - 3} ${top} q0 -6 6 -6 h${(n - 1) * 9 - 6} q6 0 6 6" stroke="#5b6b82" stroke-width="0.8" fill="none"/>`);
        const lines = wrapText(`BONDED: ${L.bonding.join(' · ')}`, 30);
        lines.forEach((t, i) => out.push(`<text x="${x0 - 4}" y="${top - 12 - (lines.length - 1 - i) * 10}" font-size="8" fill="#5b6b82">${esc(t)}</text>`));
      }
      // Incoming earths from the boards this one feeds (named), into the bar's right end.
      const fed = project.boards.filter((b) => b.upstreamId === it.equipment).map((b) => b.id);
      if (fed.length) {
        const ex = cx + 80, shown = fed.slice(0, 3), more = fed.length - shown.length;
        out.push(`<path d="M${ex + 54} ${by + 5} H${ex + 8}" stroke="${GREEN}" stroke-width="1.2" stroke-dasharray="2 3" fill="none"/>`, headLeft(ex, by + 5));
        [...shown.map((id) => `from ${id}`), ...(more ? [`+ ${more} more`] : [])].forEach((t, i) => out.push(`<text x="${ex + 12}" y="${by + 24 + i * 10}" font-size="8" fill="${GREEN}">${esc(t)}</text>`));
      }
      spread(it, LP, 84);
      x += w + 20;
    }
    if (lvs.length) zone(lvStart, LT, x - lvStart, lvTitle);
    right = Math.max(right, x);
    y += BAND_H;
  }

  // ---- Pit interconnections: same kind, same substation; dashed, one depth per kind ----
  const depth: Record<string, number> = { rmu: 50, txn: 50, txb: 64, lv: 50, sub: 64 };
  const kindOf = new Map(L.pits.map((p) => [p.id, p.kind]));
  const ownPair = new Set(L.items.flatMap((it) => { const ids = pitsOf(it).map((p) => p.id); return ids.slice(1).map((id, i) => `${ids[i]}|${id}`); }));
  /** A link to a pit on another row: a dashed stub with a break mark and the other pit's ID, at both ends. */
  // The stub points away from the pit's own same-row link, so it never lies on top of it.
  const sameRow = L.links.filter(([a, b]) => !ownPair.has(`${a}|${b}`) && pitX.has(a) && pitX.has(b) && pitY.get(a) === pitY.get(b));
  const linksRight = (id: string) => sameRow.some(([a, b]) => (a === id && pitX.get(b)! > pitX.get(a)!) || (b === id && pitX.get(a)! > pitX.get(b)!));
  const continues = (id: string, d: number, to: string) => {
    const x = pitX.get(id)!, py = pitY.get(id)!, s = linksRight(id) ? -1 : 1;
    return `<path d="M${x} ${py + 34} V${d} h${s * 22}" stroke="${GREEN}" stroke-width="1.6" stroke-dasharray="6 3" fill="none"/><path d="M${x + s * 22} ${d - 5} q${s * 5} 5 0 10" stroke="${GREEN}" stroke-width="1.4" fill="none"/><text x="${x + s * 30}" y="${d + 3}" font-size="8" fill="${GREEN}" text-anchor="${s < 0 ? 'end' : 'start'}">to ${esc(to)}</text>`;
  };
  for (const [a, b] of L.links) {
    if (ownPair.has(`${a}|${b}`) || !pitX.has(a) || !pitX.has(b)) continue;
    const ax = pitX.get(a)!, bx = pitX.get(b)!, py = pitY.get(a)!, d = py + depth[kindOf.get(a)!];
    if (pitY.get(b) !== py) {
      out.push(continues(a, d, b), continues(b, pitY.get(b)! + depth[kindOf.get(b)!], a));
      continue;
    }
    out.push(`<path d="M${ax} ${py + 34} V${d} H${bx} V${py + 34}" stroke="${GREEN}" stroke-width="1.6" stroke-dasharray="6 3" fill="none"/>`);
  }
  // A measured value takes the colour of its pit's net (linked pits together), the same result as the Checks list.
  const netOf = new Map(L.nets.flatMap((n) => n.pits.map((id) => [id, n] as const)));
  const badge = (x: number, y: number, p: (typeof L.pits)[number]) => {
    const net = netOf.get(p.id);
    const [fill, stroke] = net?.ok === undefined ? ['#fff', '#5b6b82'] : net.ok ? ['#e8f5ec', GREEN] : ['#fdecea', '#c0392b'];
    const t = `${p.measured} Ω`, w = 10 + t.length * 5.4;
    return `<rect x="${x}" y="${y}" width="${w}" height="13" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/><text x="${x + w / 2}" y="${y + 9.5}" text-anchor="middle" font-size="8" font-weight="bold" fill="${stroke}">${esc(t)}</text>`;
  };
  for (const p of L.pits) {
    if (!pitX.has(p.id)) continue;
    const px = pitX.get(p.id)!, py = pitY.get(p.id)!;
    out.push(`${pitSymbol(px, py)}<text x="${px + 10}" y="${py + 9}" font-weight="bold">${p.id}</text>${p.measured !== undefined ? badge(px + 10, py + 13, p) : ''}`);
  }

  // ---- Legend and notes -------------------------------------------------------
  const ly = y + 10, lx = 40;
  const rows: [string, string, number][] = [
    [`<g transform="translate(26 -16) scale(.5)">${rmuSymbol(0, 0)}</g>`, 'RMU: 2 × ring load-break switch + 1 × T-off switch-fuse (IEC 60617)', 44],
    [`<g transform="translate(26 -10)">${txSymbol(0, 0, 7)}</g>`, 'Transformer', 30],
    [`<rect x="8" y="-5" width="36" height="10" rx="2" fill="${CU}" fill-opacity="0.18" stroke="${CU}" stroke-width="1.3"/>`, 'Equipment earth bar with ID (EB-RMU / EB-TX(N) / EB-TX(B))', 26],
    [testLink(30, 0), 'Test link between the earth bar and its pits', 26],
    [`${ln(8, -5, 44, -5, 2.6)}${ln(8, 5, 44, 5, 2.6, GREEN)}${ln(20, -5, 20, 5, 1.4)}`, 'Main board N and E bars with the N–E link (TN-S: main board only)', 26],
    [separation(8, 44, 4, '≥ 6 m'), 'Minimum separation between pits', 26],
    [`<rect x="12" y="-7" width="30" height="13" rx="2" fill="#e8f5ec" stroke="${GREEN}" stroke-width="0.8"/>`, 'Measured resistance: green within the limit for its pit group, red above', 26],
    [`<path d="M8 0 H44" stroke="${GREEN}" stroke-width="1.6"/>`, `Earth conductor 1C ${mm} mm² CU/PVC`, 26],
    [`<path d="M8 0 H44" stroke="${GREEN}" stroke-width="1.6" stroke-dasharray="6 3"/>`, 'Pit interconnection (same kind, same substation)', 26],
    [`<path d="M8 0 H30" stroke="${GREEN}" stroke-width="1.6" stroke-dasharray="6 3"/><path d="M30 -5 q5 5 0 10" stroke="${GREEN}" stroke-width="1.4" fill="none"/>`, 'Interconnection continues to a pit on another row (to E…)', 26],
    [`<path d="M44 0 H16" stroke="${GREEN}" stroke-width="1.2" stroke-dasharray="2 3"/>${headLeft(8, 0)}`, 'Incoming earth / CPC from the boards it feeds (named)', 26],
    [`<path d="M26 9 V0" stroke="${GREEN}" stroke-width="1.2"/>${headUp(26, -8)}`, 'Bonding of metal parts to the main earth bar', 26],
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
    '5. EARTH PITS AT LEAST 6.0 m APART. LIGHTNING PROTECTION NOT SHOWN.',
    '6. ONE N–E LINK ONLY, AT THE MAIN BOARD (TN-S). EVERY EARTH BAR HAS A TEST LINK TO ITS PITS.'
  ];
  const noteSvg = `<g transform="translate(${lx + 560} ${ly})">${notes.map((t, i) => `<text x="0" y="${18 + i * 16}" font-size="9"${i ? '' : ' font-weight="bold"'}>${esc(t)}</text>`).join('')}</g>`;

  const w = Math.max(right + 30, 1300);
  // The schedule is part of the SVG so every drawing export carries the same
  // pit IDs and test information. Wrap long cells rather than compressing text.
  const tableX = 40, tableW = w - 80;
  const columns = [0.06, 0.27, 0.23, 0.17, 0.16, 0.11].map((f) => f * tableW);
  const wrap = (text: string, width: number) => {
    const max = Math.max(1, Math.floor((width - 12) / 6));
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      if (line && line.length + word.length + 1 > max) { lines.push(line); line = ''; }
      let rest = word;
      while (rest.length > max) { if (line) { lines.push(line); line = ''; } lines.push(rest.slice(0, max)); rest = rest.slice(max); }
      line = line ? `${line} ${rest}` : rest;
    }
    if (line) lines.push(line);
    return lines;
  };
  let tableY = ly + legendH + 40;
  let schedule = `<text x="${tableX}" y="${tableY - 10}" font-size="12" font-weight="bold">EARTH PIT SCHEDULE</text>`;
  const row = (cells: string[], heading = false) => {
    const lines = cells.map((s, i) => wrap(s, columns[i]));
    const rh = Math.max(1, ...lines.map((ls) => ls.length)) * 14 + 12;
    let cx = tableX;
    lines.forEach((ls, i) => {
      schedule += `<rect x="${cx}" y="${tableY}" width="${columns[i]}" height="${rh}" fill="none" stroke="#999" stroke-width="0.7"/>`;
      ls.forEach((text, j) => { schedule += `<text x="${cx + 6}" y="${tableY + 16 + j * 14}" font-size="9"${heading ? ' font-weight="bold"' : ''}>${esc(text)}</text>`; });
      cx += columns[i];
    });
    tableY += rh;
  };
  row(['Pit', 'Equipment / connection', 'Earth system / substation', 'Conductor', 'Electrode', 'Measured'], true);
  for (const p of L.pits) {
    const it = L.items.find((item) => item.key === p.itemKey)!;
    row([p.id, `${it.equipment} / ${it.point}`, `${kindInfo(p.kind).label} / ${it.group}`, `1C ${mm} mm² Cu/PVC`, `${L.electrodeM} m Cu-bonded rod`, p.measured === undefined ? 'Not tested' : `${p.measured} ohm`]);
  }
  const h = includeSchedule ? tableY + 20 : ly + legendH + 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial" font-size="10" fill="#111">
  <rect width="${w}" height="${h}" fill="#fff"/>
  <text x="${w / 2}" y="30" text-anchor="middle" font-size="14" font-weight="bold">EARTHING SCHEMATIC DIAGRAM</text>
  ${out.join('\n')}
  ${legend}
  ${noteSvg}
  ${includeSchedule ? schedule : ''}
</svg>`;
  return { svg, w, h };
}
