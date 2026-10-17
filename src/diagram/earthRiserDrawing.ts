import type { Project } from '../types';
import { earthRiserLayout, type EarthRiserLayout } from '../model/earthRiser';
import { earthSheetNo } from '../model/boardEarth';
import { earthingLayout } from '../model/earthingPlan';
import { pitTags } from './earthingDrawing';

/** Earth riser diagram of one building (printable SVG, earthing-schematic style).
 *
 * Earth only. Floors bottom to top, the riser shaft on the left with the earth
 * riser tape running from the main earth bar (MEB) in the LV room to the top
 * floor; a tee clamp and a floor earth bar (FEB) on every floor. Each panel is
 * drawn on its floor with its earth bar and a separate conductor (its incoming
 * CPC size) to the FEB — or to the earth bar of the panel on the same floor
 * that feeds it. The MEB goes to the LV earth pits of the earthing schematic.
 * Panel schedule, legend and notes below. Screen colours (earth green, copper
 * bars) turn black in the printed sheet (mono). */

const GREEN = '#1a7f37', CU = '#b86b2b', MUT = '#5b6b82';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ln = (x1: number, y1: number, x2: number, y2: number, w = 1.3, c = '#111') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`;
const path = (d: string, w = 1.4, c = GREEN) => `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none"/>`;
const bar = (x: number, y: number, w: number) => {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="7" rx="1.5" fill="${CU}" fill-opacity="0.18" stroke="${CU}" stroke-width="1.2"/>`;
  for (let i = 0, n = Math.max(2, Math.floor((w - 6) / 12)); i < n; i++) s += `<circle cx="${x + 6 + i * ((w - 12) / (n - 1))}" cy="${y + 3.5}" r="1.6" fill="#111"/>`;
  return s;
};
const pitSymbol = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="6" fill="#fff" stroke="#111" stroke-width="1.3"/>${ln(x, y + 6, x, y + 22, 1.2)}<rect x="${x - 18}" y="${y + 10}" width="36" height="34" fill="none" stroke="#111" stroke-width="1" stroke-dasharray="4 3"/>${ln(x - 10, y + 22, x + 10, y + 22)}${ln(x - 6, y + 27, x + 6, y + 27)}${ln(x - 3, y + 32, x + 3, y + 32)}`;
const testLink = (x: number, y: number) => `<rect x="${x - 5}" y="${y - 4}" width="10" height="8" fill="#fff" stroke="#111" stroke-width="1"/>${ln(x - 5, y, x + 5, y, 1)}`;
const teeClamp = (x: number, y: number) => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="#fff" stroke="#111" stroke-width="1.2"/>`;

const RX = 210;        // earth riser tape
const FEB_X = RX + 22; // floor earth bar
const FEB_W = 64;
const BX0 = RX + 140;  // first panel
const BOX_W = 150, BOX_H = 44, PITCH = 186;

export function earthRiserDrawing(project: Project, buildingId: string, opts: { mono?: boolean; working?: boolean } = {}, given?: EarthRiserLayout): { svg: string; w: number; h: number } {
  const EL = earthingLayout(project);
  const L = given ?? earthRiserLayout(project, buildingId, EL);
  /** Pit tag as on the earthing schematic (EP-MDB-1A …); the test ID when it has none. */
  const tags = pitTags(project, EL);
  const tagOf = (id: string) => tags.get(id) ?? id;
  const sheetNo = earthSheetNo(project);
  const out: string[] = [];
  const maxBoards = Math.max(1, ...L.floors.map((f) => f.boards.length));
  const mainsW = RX + 60 + L.mains.length * 300;
  const w = Math.max(BX0 + maxBoards * PITCH + 40, mainsW, 1200);

  // Row heights: panel, its earth bar, one lane per conductor from a panel to the ones it feeds, then the FEB lanes.
  const heights = L.floors.map((f) => {
    const kids = Math.max(0, ...f.boards.map((b) => f.boards.filter((c) => c.toBoard === b.board.id).length));
    const feb = f.boards.filter((b) => !b.toBoard).length;
    return Math.max(96, 74 + kids * 5 + feb * 5 + 14);
  });
  const TOP = 70;
  const total = heights.reduce((s, h) => s + h, 0);
  const tapeTop: number[] = [];
  // Floors top to bottom on the sheet.
  let y = TOP;
  for (let i = L.floors.length - 1; i >= 0; i--) {
    const f = L.floors[i], h = heights[i];
    out.push(`<text x="30" y="${y + 30}" font-weight="bold">${esc(f.floor.name.toUpperCase())}</text>`);
    const e = f.floor.elevationM;
    out.push(`<text x="30" y="${y + 44}" font-size="8.5" fill="${MUT}">FFL ${e >= 0 ? (e === 0 ? '±' : '+') : '−'}${Math.abs(e).toFixed(2)} m</text>`);
    out.push(ln(20, y + h, w - 20, y + h, 0.6, '#999').replace('/>', ' stroke-dasharray="8 4"/>'));
    // FEB on the riser tape.
    const febY = y + 64;
    out.push(teeClamp(RX, febY + 3.5), path(`M${RX + 5} ${febY + 3.5} H${FEB_X}`, 1.6), bar(FEB_X, febY, FEB_W));
    out.push(`<text x="${FEB_X}" y="${febY - 5}" font-size="8.5" font-weight="bold">${esc(f.feb)}</text>`);
    tapeTop.push(febY + 3.5);

    // Panels, left to right.
    const xOf = new Map<string, number>();
    f.boards.forEach((b, k) => xOf.set(b.board.id, BX0 + k * PITCH));
    const barY = y + 14 + BOX_H + 4;
    const kidsOf = (id: string) => f.boards.filter((c) => c.toBoard === id);
    const kidLanes = Math.max(0, ...f.boards.map((b) => kidsOf(b.board.id).length));
    f.boards.forEach((b) => {
      const x = xOf.get(b.board.id)!;
      const kind = b.board.kind ?? 'DB';
      out.push(`<rect x="${x}" y="${y + 14}" width="${BOX_W}" height="${BOX_H}" fill="#fff" stroke="#111" stroke-width="1.3"/>`);
      out.push(`<text x="${x + BOX_W / 2}" y="${y + 27}" text-anchor="middle" font-weight="bold">${esc(b.board.id)}</text>`);
      out.push(`<text x="${x + BOX_W / 2}" y="${y + 39}" text-anchor="middle" font-size="8.5" fill="${MUT}">${esc([kind, b.board.ratedCurrentA ? `${b.board.ratedCurrentA} A` : ''].filter(Boolean).join(' · '))}</text>`);
      out.push(`<text x="${x + BOX_W / 2}" y="${y + 51}" text-anchor="middle" font-size="8.5">${esc(`PE ${b.cpcMm2 ? `${b.cpcMm2} mm²` : '—'} → ${b.toBoard ?? f.feb}`)}</text>`);
      out.push(bar(x + BOX_W / 2 - 30, barY, 60));
    });
    // Panel to the panels it feeds on this floor: one conductor each, nearest on the upper lane.
    f.boards.forEach((b) => {
      const px = xOf.get(b.board.id)! + BOX_W / 2;
      kidsOf(b.board.id).forEach((c, i) => {
        const cx = xOf.get(c.board.id)! + BOX_W / 2 - 18, ly = barY + 12 + i * 5;
        out.push(path(`M${px + 6 + i * 4} ${barY + 7} V${ly} H${cx} V${barY + 7}`, 1.1));
      });
    });
    // FEB to each panel earthed from it: nearest on the upper lane.
    const fromFeb = f.boards.filter((b) => !b.toBoard);
    fromFeb.forEach((b, j) => {
      const cx = xOf.get(b.board.id)! + BOX_W / 2 - 18, ly = barY + 14 + kidLanes * 5 + j * 5;
      const sx = FEB_X + FEB_W - 6 - Math.min(j, 6) * 6;
      out.push(path(`M${sx} ${febY + 7} V${Math.max(ly, febY + 12)} H${cx} V${barY + 7}`, 1.1));
    });
    if (!f.boards.length) out.push(`<text x="${BX0}" y="${febY + 6}" font-size="8.5" fill="${MUT}">No panels on this floor — FEB for containment and riser steelwork bonding</text>`);
    y += h;
  }
  const floorsBottom = TOP + total;

  // LV room: main board(s), MEB, LV earth pits.
  const yb = floorsBottom + 20;
  out.push(`<text x="30" y="${yb + 30}" font-weight="bold">LV ROOM</text><text x="30" y="${yb + 44}" font-size="8.5" fill="${MUT}">main earth bar</text>`);
  const mebY = yb + 76;
  L.mains.forEach((m, i) => {
    const mx = RX - 30 + i * 300;
    out.push(`<rect x="${mx + 70}" y="${yb + 10}" width="150" height="40" fill="#fff" stroke="#111" stroke-width="1.3"/>`);
    out.push(`<text x="${mx + 145}" y="${yb + 26}" text-anchor="middle" font-weight="bold">${esc(m.board.id)}</text>`);
    out.push(`<text x="${mx + 145}" y="${yb + 40}" text-anchor="middle" font-size="8.5" fill="${MUT}">${esc([m.board.kind ?? 'MDB', m.board.ratedCurrentA ? `${m.board.ratedCurrentA} A` : ''].filter(Boolean).join(' · '))}</text>`);
    out.push(path(`M${mx + 145} ${yb + 50} V${mebY}`, 1.6), bar(mx, mebY, 180));
    out.push(`<text x="${mx}" y="${mebY + 20}" font-size="8.5" font-weight="bold">${esc(m.meb)}</text>`);
    // MEB to its pits, each through a test link.
    const py = mebY + 62;
    if (!m.pits.length) out.push(`<text x="${mx + 90}" y="${py}" text-anchor="middle" fill="#c0392b" font-weight="bold">NO LV EARTH PIT</text>`);
    m.pits.forEach((id, k) => {
      const sx = mx + 14 + k * 14, px = mx + 36 + k * 78;
      out.push(path(`M${sx} ${mebY + 7} V${py - 18} H${px} V${py - 6}`, 1.4), testLink(px, py - 14));
      out.push(pitSymbol(px, py), `<text x="${px}" y="${py + 56}" text-anchor="middle" font-size="8.5" font-weight="bold">${esc(tagOf(id))}</text>`);
      if (tags.has(id)) out.push(`<text x="${px}" y="${py + 67}" text-anchor="middle" font-size="8" fill="${MUT}">${esc(id)}</text>`);
    });
    if (m.pits.length) out.push(`<text x="${mx + 10 + m.pits.length * 78}" y="${py + 4}" font-size="8.5" fill="${MUT}">LV earth pits — see ${esc(sheetNo)}</text>`);
  });
  if (!L.mains.length) out.push(`<text x="${RX + 40}" y="${mebY + 4}" fill="#c0392b" font-weight="bold">No main board feeds the panels of this building</text>`);
  // The tape: top FEB down to the MEB of the first main board, then along to the others.
  const tapeFrom = Math.min(...tapeTop, floorsBottom);
  const mebEnd = L.mains.length ? RX - 30 + (L.mains.length - 1) * 300 + 20 : RX;
  out.push(path(`M${RX} ${tapeFrom} V${mebY}`, 3.4));
  if (L.mains.length > 1) out.push(path(`M${RX} ${mebY - 8} H${mebEnd}V${mebY}`, 3.4));
  out.push(`<rect x="${RX - 26}" y="${TOP - 18}" width="52" height="${floorsBottom - TOP + 18}" fill="none" stroke="#111" stroke-width="0.8" stroke-dasharray="10 3 2 3"/>`);
  out.push(`<text x="${RX}" y="${TOP - 24}" text-anchor="middle" font-size="8.5" font-weight="bold">RISER SHAFT</text>`);
  const ty = (tapeFrom + floorsBottom) / 2;
  out.push(`<text x="${RX - 12}" y="${ty}" text-anchor="middle" font-size="8.5" font-weight="bold" fill="${GREEN}" transform="rotate(-90 ${RX - 12} ${ty})">EARTH RISER ${esc(L.tape.toUpperCase())}</text>`);

  let yEnd = mebY + 150;
  if (!opts.working) {
    // Legend and notes.
    const lx = 40, ly = yEnd;
    const rows: [string, string][] = [
      [path('M8 0 H52', 3.4), `Earth riser — ${L.tape}`],
      [`${path('M8 0 H52', 1.4)}`, 'Protective (earth) conductor, Cu/PVC G/Y, size shown at each panel'],
      [`<g transform="translate(10 -3.5)">${bar(0, 0, 40)}</g>`, 'Earth bar: MEB main, FEB floor, panel earth bar'],
      [`${path('M8 0 H52', 1.6)}${teeClamp(20, 0)}`, 'Tee clamp on the riser'],
      [testLink(30, 0), 'Test link'],
      [`<g transform="translate(30 -18)">${pitSymbol(0, 0)}</g>`, 'LV earth pit: tag (EP-…) and test ID (E…) as on the earthing schematic']
    ];
    let ry = 40, body = '';
    for (const [sym, text] of rows) { const rh = text.startsWith('LV earth pit') ? 54 : 22; const cy = ry + rh / 2; body += `<g transform="translate(6 ${cy})">${sym}</g><text x="72" y="${cy + 3}" font-size="9">${esc(text)}</text>`; ry += rh; }
    out.push(`<g transform="translate(${lx} ${ly})"><rect x="0" y="0" width="440" height="${ry + 8}" fill="#fff" stroke="#111"/><text x="10" y="18" font-weight="bold">LEGEND</text>${ln(0, 24, 440, 24, 0.6)}${body}</g>`);
    const notes = [
      'NOTES',
      `1. EARTH RISER ${L.tape.toUpperCase()} IN THE ELECTRICAL RISER SHAFT, CONTINUOUS FROM THE MAIN EARTH BAR TO THE TOP FLOOR.`,
      '2. A FLOOR EARTH BAR (FEB) ON EVERY FLOOR, CONNECTED TO THE RISER BY A TEE CLAMP; JOINTS BOLTED OR EXOTHERMIC.',
      '3. EACH SMDB / DB EARTH BAR CONNECTED TO ITS FLOOR EARTH BAR WITH A SEPARATE CONDUCTOR, SIZE AS ITS INCOMING CPC.',
      '4. A PANEL FED FROM ANOTHER PANEL ON THE SAME FLOOR CONNECTS TO THAT PANEL\'S EARTH BAR.',
      `5. MAIN EARTH BAR TO THE LV EARTH PITS: SEE EARTHING SCHEMATIC ${sheetNo.toUpperCase()}. LV EARTH ≤ 1 Ω (DEWA).`,
      '6. CABLE CONTAINMENT, BUSBAR TRUNKING ENCLOSURE AND RISER STEELWORK BONDED TO THE FEB ON EACH FLOOR.',
      ...(L.notOnLevel.length ? [`7. NOT SHOWN — NO LEVEL IN THIS BUILDING: ${L.notOnLevel.join(', ')}.`] : [])
    ];
    out.push(`<g transform="translate(${lx + 480} ${ly})">${notes.map((t, i) => `<text x="0" y="${18 + i * 16}" font-size="9"${i ? '' : ' font-weight="bold"'}>${esc(t)}</text>`).join('')}</g>`);
    yEnd = ly + Math.max(ry + 8, notes.length * 16 + 10) + 40;

    // Panel earthing schedule.
    const cols = [0.11, 0.15, 0.13, 0.18, 0.1, 0.33].map((f) => f * (w - 80));
    let tyy = yEnd;
    out.push(`<text x="40" y="${tyy - 10}" font-size="12" font-weight="bold">PANEL EARTHING SCHEDULE</text>`);
    const row = (cells: string[], head = false) => {
      let cx = 40;
      cells.forEach((c, i) => {
        out.push(`<rect x="${cx}" y="${tyy}" width="${cols[i]}" height="22" fill="none" stroke="#999" stroke-width="0.7"/><text x="${cx + 6}" y="${tyy + 15}" font-size="9"${head ? ' font-weight="bold"' : ''}>${esc(c)}</text>`);
        cx += cols[i];
      });
      tyy += 22;
    };
    row(['Floor', 'Panel', 'Fed from', 'Incoming feeder', 'PE conductor', 'Earth bar connected to'], true);
    for (const f of L.floors) for (const b of f.boards) {
      const fd = b.feeder;
      row([f.floor.name, b.board.id, b.board.upstreamId ?? '—', fd ? `${fd.cores}C ${fd.cableCsaMm2} mm² · ${fd.lengthM} m` : '—', b.cpcMm2 ? `${b.cpcMm2} mm² Cu` : '—', b.toBoard ? `${b.toBoard} earth bar` : f.feb]);
    }
    for (const m of L.mains) row(['LV room', m.board.id, '—', '—', '—', `${m.meb} → pits ${m.pits.map((id) => (tags.has(id) ? `${tagOf(id)} (${id})` : id)).join(', ') || 'none'}`]);
    yEnd = tyy + 20;
  }

  const h = yEnd;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial" font-size="10" fill="#111">
  <rect width="${w}" height="${h}" fill="#fff"/>
  <text x="${w / 2}" y="26" text-anchor="middle" font-size="14" font-weight="bold">EARTHING RISER DIAGRAM — ${esc(L.buildingName.toUpperCase())}</text>
  <text x="${w / 2}" y="40" text-anchor="middle" font-size="9" fill="${MUT}">Dedicated earth riser with a floor earth bar on every floor</text>
  ${out.join('\n')}
</svg>`;
  return { svg: opts.mono ? svg.replace(/#(1a7f37|5b6b82|b86b2b|c0392b)/gi, '#111') : svg, w, h };
}
