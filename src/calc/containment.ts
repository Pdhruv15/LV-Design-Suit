import { DEFAULT_CABLE_ODS, groupingFactor, lookupOd, pickTray, TRAY_WIDTHS } from './cableTray';

/** Custom containment calculation (no design needed): a list of cables →
 * the tray / ladder / basket width, the trunking or conduit size by fill,
 * or a trench / duct bank for buried cables with its soil derating. */

export type ContainmentType = 'tray' | 'ladder' | 'basket' | 'trunking' | 'conduit' | 'trench' | 'ducts';
export const CONTAINMENT_LABEL: Record<ContainmentType, string> = {
  tray: 'Perforated tray', ladder: 'Cable ladder', basket: 'Wire basket', trunking: 'Trunking', conduit: 'Conduit', trench: 'Trench (direct buried)', ducts: 'Duct bank (buried)'
};

export interface ContainmentCable { name: string; cores: number; csaMm2: number; qty: number; odMm?: number; kgPerM?: number }
export interface ContainmentInput {
  type: ContainmentType;
  cables: ContainmentCable[];
  // tray / ladder / basket
  layout: 'touching' | 'spaced' | 'fill';
  fillPct: number; // fill method / trunking
  depthMm: number; // tray side height
  sparePct: number;
  maxWidthMm: number;
  // conduit
  conduitFillPct?: number; // blank: 53 / 31 / 40 % by number of cables
  // buried
  burialDepthM: number;
  soilResistivity: number; // K·m/W
  groundTempC: number;
  spacing: 'touching' | 'one-d' | '250mm';
  title?: string;
}

export const CONTAINMENT_DEFAULT: ContainmentInput = {
  type: 'tray', layout: 'spaced', fillPct: 40, depthMm: 50, sparePct: 25, maxWidthMm: 600,
  burialDepthM: 0.7, soilResistivity: 1.5, groundTempC: 35, spacing: 'one-d',
  cables: [{ name: 'Sub-main', cores: 4, csaMm2: 95, qty: 3 }, { name: 'Feeders', cores: 4, csaMm2: 25, qty: 6 }, { name: 'Final circuits', cores: 4, csaMm2: 6, qty: 8 }]
};

/** Standard trunking (W × H, mm) and heavy-gauge conduit (nominal, inside diameter mm). */
export const TRUNKING_SIZES: [number, number][] = [[50, 50], [75, 50], [75, 75], [100, 50], [100, 75], [100, 100], [150, 50], [150, 75], [150, 100], [150, 150], [200, 100], [200, 150], [225, 100], [300, 100], [300, 150], [300, 200]];
export const CONDUIT_SIZES: [number, number][] = [[20, 16.9], [25, 21.4], [32, 27.8], [40, 35.4], [50, 44.3], [63, 56.4]];
const DUCT_SIZES_MM = [50, 75, 100, 125, 150, 160, 200];

/** Burial derating (IEC 60364-5-52, typical values for XLPE 90 °C). */
const GROUND_TEMP: [number, number][] = [[10, 1.07], [15, 1.04], [20, 1], [25, 0.96], [30, 0.93], [35, 0.89], [40, 0.85], [45, 0.8], [50, 0.76]];
/** Soil thermal resistivity (K·m/W) → factor, reference 2.5 (IEC 60364-5-52 Table B.52.16). */
const SOIL_DIRECT: [number, number][] = [[0.5, 1.88], [0.7, 1.62], [1, 1.5], [1.5, 1.28], [2, 1.12], [2.5, 1], [3, 0.9]];
const SOIL_DUCTS: [number, number][] = [[0.5, 1.28], [0.7, 1.2], [1, 1.18], [1.5, 1.1], [2, 1.05], [2.5, 1], [3, 0.96]];
const GROUP_DIRECT: Record<ContainmentInput['spacing'], number[]> = { // circuits 1…6+
  touching: [1, 0.75, 0.65, 0.6, 0.55, 0.5], 'one-d': [1, 0.8, 0.7, 0.6, 0.55, 0.55], '250mm': [1, 0.85, 0.75, 0.7, 0.65, 0.6]
};
const GROUP_DUCTS: number[] = [1, 0.85, 0.75, 0.7, 0.65, 0.6];
const interp = (t: [number, number][], x: number) => {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return t[t.length - 1][1];
};

export interface ContainmentLine extends ContainmentCable { od: number; kg: number; estimated: boolean }
export interface ContainmentResult {
  type: ContainmentType;
  lines: ContainmentLine[];
  count: number;
  sumOdMm: number;
  areaMm2: number;
  kgPerM: number;
  size: string; // e.g. "300 × 50 mm", "Ø 32 mm", "2 × 150 × 100 mm"
  widthMm: number;
  heightMm: number;
  runs: number; // tiers / runs / conduits
  fillPct: number;
  sparePct?: number;
  groupFactor?: number;
  soil?: { temp: number; resistivity: number; group: number; total: number; ductMm?: number; rows?: number; cols?: number; depthM: number };
  laid: number[]; // diameters, largest first
  notes: string[];
  status: 'ok' | 'warn';
}

export function calcContainment(i: ContainmentInput): ContainmentResult {
  const lines: ContainmentLine[] = i.cables.filter((c) => c.qty > 0 && (c.odMm || c.csaMm2)).map((c) => {
    const l = lookupOd(DEFAULT_CABLE_ODS, c.cores, c.csaMm2);
    return { ...c, od: c.odMm || l.odMm, kg: c.kgPerM || l.kgPerM, estimated: !c.odMm && !l.found };
  });
  const laid = lines.flatMap((l) => Array.from({ length: Math.round(l.qty) }, () => l.od)).sort((a, b) => b - a);
  const count = laid.length;
  const sumOdMm = laid.reduce((s, d) => s + d, 0);
  const areaMm2 = laid.reduce((s, d) => s + (Math.PI * d * d) / 4, 0);
  const kgPerM = lines.reduce((s, l) => s + l.kg * l.qty, 0);
  const notes: string[] = [];
  if (lines.some((l) => l.estimated)) notes.push('Some diameters are from the next size in the cable data — type the OD if you have the datasheet');
  const base = { type: i.type, lines, count, sumOdMm, areaMm2, kgPerM, laid, notes };
  const spare = 1 + i.sparePct / 100;
  if (!count) return { ...base, size: '—', widthMm: 0, heightMm: 0, runs: 0, fillPct: 0, status: 'ok' };

  if (i.type === 'tray' || i.type === 'ladder' || i.type === 'basket') {
    const maxD = laid[0];
    const need = i.layout === 'fill' ? areaMm2 / (i.depthMm * (i.fillPct / 100)) : i.layout === 'touching' ? sumOdMm : sumOdMm + laid.slice(1).reduce((s, d) => s + d, 0);
    const widths = i.type === 'basket' ? TRAY_WIDTHS.filter((w) => w <= 600) : TRAY_WIDTHS;
    const t = pickTray(need * spare, widths, i.maxWidthMm);
    const fillPct = (areaMm2 / (t.widthMm * i.depthMm * t.tiers)) * 100;
    const g = groupingFactor(i.type === 'ladder' ? 'ladder' : 'perforated', i.layout === 'spaced' ? 'spaced' : 'touching', Math.ceil(count / t.tiers), t.tiers);
    if (maxD > i.depthMm) notes.push(`Largest cable (${maxD.toFixed(0)} mm) is taller than the ${i.depthMm} mm side — use a deeper tray`);
    if (i.layout === 'spaced') notes.push('Spaced one diameter apart: the grouping factor is the better (spaced) one');
    return { ...base, size: `${t.tiers > 1 ? `${t.tiers} tiers × ` : ''}${t.widthMm} × ${i.depthMm} mm`, widthMm: t.widthMm, heightMm: i.depthMm, runs: t.tiers, fillPct, sparePct: ((t.widthMm * t.tiers) / Math.max(need, 1) - 1) * 100, groupFactor: g, status: maxD > i.depthMm ? 'warn' : 'ok' };
  }

  if (i.type === 'trunking') {
    const limit = i.fillPct || 45;
    const need = (areaMm2 * spare) / (limit / 100);
    const pick = (n: number) => TRUNKING_SIZES.find(([w, h]) => w * h >= need / n && h >= laid[0]);
    let runs = 1, s = pick(1);
    while (!s && runs < 6) s = pick(++runs);
    s ??= TRUNKING_SIZES[TRUNKING_SIZES.length - 1];
    notes.push(`Space factor ${limit} % of the trunking's area (BS 7671 / IET On-Site Guide: 45 %)`);
    const fillPct = (areaMm2 / (s[0] * s[1] * runs)) * 100;
    return { ...base, size: `${runs > 1 ? `${runs} × ` : ''}${s[0]} × ${s[1]} mm`, widthMm: s[0], heightMm: s[1], runs, fillPct, sparePct: (limit / fillPct - 1) * 100, status: 'ok' };
  }

  if (i.type === 'conduit') {
    const limit = i.conduitFillPct ?? (count === 1 ? 53 : count === 2 ? 31 : 40);
    const fits = (id: number, n: number) => (areaMm2 / n) / ((Math.PI * id * id) / 4) <= limit / 100 && id >= laid[0] * 1.1;
    let runs = 1, s = CONDUIT_SIZES.find(([, id]) => fits(id, 1));
    while (!s && runs < 10) { runs++; s = CONDUIT_SIZES.find(([, id]) => fits(id, runs)); }
    s ??= CONDUIT_SIZES[CONDUIT_SIZES.length - 1];
    notes.push(`Fill limit ${limit} % (1 cable 53 %, 2 cables 31 %, 3 or more 40 % — IEC / NEC practice); bends reduce it further`);
    if (runs > 1) notes.push(`Too many cables for one ${CONDUIT_SIZES[CONDUIT_SIZES.length - 1][0]} mm conduit: ${runs} conduits`);
    const fillPct = (areaMm2 / runs / ((Math.PI * s[1] * s[1]) / 4)) * 100;
    return { ...base, size: `${runs > 1 ? `${runs} × ` : ''}Ø ${s[0]} mm conduit`, widthMm: s[1], heightMm: s[1], runs, fillPct, status: fillPct > limit ? 'warn' : 'ok' };
  }

  // Buried: a trench with the cables in one layer, or one cable per duct.
  const temp = interp(GROUND_TEMP, i.groundTempC);
  const resistivity = interp(i.type === 'trench' ? SOIL_DIRECT : SOIL_DUCTS, i.soilResistivity);
  if (i.type === 'trench') {
    const gap = i.spacing === 'touching' ? 0 : i.spacing === 'one-d' ? null : 250;
    const inner = gap === null ? sumOdMm + laid.slice(1).reduce((s, d) => s + d, 0) : sumOdMm + gap * (count - 1);
    const widthMm = Math.max(300, Math.ceil((inner + 2 * 75) / 50) * 50); // 75 mm each side, to 50 mm
    const group = GROUP_DIRECT[i.spacing][Math.min(count, 6) - 1];
    const total = temp * resistivity * group;
    notes.push(`Trench ${widthMm} mm wide × ${(i.burialDepthM + 0.1).toFixed(2)} m deep: cables ${i.burialDepthM} m down on 75 mm sand bedding, 100 mm sand cover, cable tiles and warning tape above`);
    return { ...base, size: `${widthMm} mm wide trench`, widthMm, heightMm: i.burialDepthM * 1000, runs: 1, fillPct: 0, soil: { temp, resistivity, group, total, depthM: i.burialDepthM }, status: total < 0.6 ? 'warn' : 'ok' };
  }
  const ductMm = DUCT_SIZES_MM.find((d) => d >= laid[0] * 1.5) ?? DUCT_SIZES_MM[DUCT_SIZES_MM.length - 1];
  const spareDucts = Math.max(1, Math.ceil(count * (i.sparePct / 100)));
  const ducts = count + spareDucts;
  const cols = Math.min(ducts, 4), rows = Math.ceil(ducts / cols);
  const pitch = ductMm + 50;
  const widthMm = cols * pitch + 150, heightMm = rows * pitch + 150;
  const group = GROUP_DUCTS[Math.min(count, 6) - 1];
  const total = temp * resistivity * group;
  notes.push(`${ducts} ducts Ø ${ductMm} mm (${count} cables + ${spareDucts} spare), ${rows} × ${cols}, 50 mm between ducts, concrete surround; draw pits at changes of direction`);
  return { ...base, size: `${ducts} × Ø ${ductMm} mm duct bank`, widthMm, heightMm, runs: ducts, fillPct: 0, soil: { temp, resistivity, group, total, ductMm, rows, cols, depthM: i.burialDepthM }, status: total < 0.6 ? 'warn' : 'ok' };
}

/** Cross-section to scale (SVG markup), the same on screen and in the report. */
export function containmentSvg(r: ContainmentResult, i: ContainmentInput, width = 520): string {
  const C = '#2a78d6', S = 'currentColor';
  if (!r.count) return '';
  if (r.type === 'conduit') {
    const id = r.widthMm, k = Math.min(160 / id, 6), R = (id * k) / 2, cx = R + 20, cy = R + 20;
    const circles: string[] = [];
    let ring = 0, placed = 0;
    for (const d of r.laid.slice(0, Math.ceil(r.laid.length / r.runs))) {
      const rr = (d * k) / 2;
      const a = placed * 2.4, dist = placed === 0 ? 0 : Math.min(R - rr, rr * 1.9 * (1 + ring * 0.6));
      circles.push(`<circle cx="${cx + dist * Math.cos(a)}" cy="${cy + dist * Math.sin(a)}" r="${rr}" fill="${C}" fill-opacity=".35" stroke="${C}"/>`);
      placed++; if (placed % 6 === 0) ring++;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cx * 2 + 120} ${cy * 2}" font-family="Arial" font-size="12"><circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${S}" stroke-width="2"/>${circles.join('')}<text x="${cx * 2 + 10}" y="${cy}" fill="${S}">Ø ${r.widthMm} mm ID</text><text x="${cx * 2 + 10}" y="${cy + 16}" fill="${S}" opacity=".7">fill ${r.fillPct.toFixed(0)} %</text></svg>`;
  }
  if (r.type === 'ducts' && r.soil) {
    const { rows = 1, cols = 1, ductMm = 100 } = r.soil;
    const k = Math.min((width - 40) / r.widthMm, 220 / r.heightMm), pitch = (ductMm + 50) * k;
    const ducts: string[] = [];
    for (let n = 0; n < rows * cols; n++) {
      const x = 20 + 75 * k + (n % cols) * pitch + pitch / 2, y = 20 + 75 * k + Math.floor(n / cols) * pitch + pitch / 2;
      const d = r.laid[n];
      ducts.push(`<circle cx="${x}" cy="${y}" r="${(ductMm * k) / 2}" fill="none" stroke="${S}"${d ? '' : ' stroke-dasharray="3 2" opacity=".6"'}/>${d ? `<circle cx="${x}" cy="${y}" r="${(d * k) / 2}" fill="${C}" fill-opacity=".35" stroke="${C}"/>` : ''}`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${r.heightMm * k + 60}" font-family="Arial" font-size="12"><rect x="20" y="20" width="${r.widthMm * k}" height="${r.heightMm * k}" fill="${S}" fill-opacity=".08" stroke="${S}"/>${ducts.join('')}<text x="20" y="${r.heightMm * k + 42}" fill="${S}">${r.widthMm} × ${r.heightMm} mm concrete surround · ${r.soil.depthM} m to top · dashed = spare duct</text></svg>`;
  }
  // Tray / ladder / basket / trunking / trench: cables in a row, largest first (first tier / run).
  const w = r.type === 'trench' ? r.widthMm : r.widthMm, h = r.type === 'trench' ? 300 : r.heightMm;
  const k = (width - 40) / w, H = h * k;
  let x = r.type === 'trench' ? 75 * k : 0;
  const per = Math.ceil(r.laid.length / Math.max(1, r.type === 'trench' ? 1 : r.runs));
  const gap = (d: number) => (r.type === 'trench' ? (i.spacing === 'touching' ? 0 : i.spacing === 'one-d' ? d : 250) : i.layout === 'spaced' ? d : 0) * k;
  const circles: string[] = [];
  const rowsMax = r.type === 'trunking' ? Math.max(1, Math.floor(r.heightMm / (r.laid[0] || 1))) : 1;
  let row = 0;
  for (const d of r.laid.slice(0, per)) {
    const rr = (d * k) / 2;
    if (x + 2 * rr > w * k) { if (row + 1 < rowsMax) { row++; x = 0; } else break; }
    circles.push(`<circle cx="${20 + x + rr}" cy="${20 + H - rr - row * 2 * rr}" r="${rr}" fill="${C}" fill-opacity=".35" stroke="${C}"/>`);
    x += 2 * rr + gap(d);
  }
  const shape = r.type === 'trench'
    ? `<path d="M20 20 V${20 + H} H${20 + w * k} V20" fill="none" stroke="${S}" stroke-width="2"/><line x1="20" y1="${20 + H - 75 * k}" x2="${20 + w * k}" y2="${20 + H - 75 * k}" stroke="${S}" stroke-dasharray="4 3" opacity=".5"/>`
    : r.type === 'trunking' ? `<rect x="20" y="20" width="${w * k}" height="${H}" fill="none" stroke="${S}" stroke-width="2"/>`
      : `<path d="M20 20 V${20 + H} H${20 + w * k} V20" fill="none" stroke="${S}" stroke-width="2.5"${r.type === 'basket' ? ' stroke-dasharray="3 2"' : ''}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${H + 52}" font-family="Arial" font-size="12">${shape}${circles.join('')}<text x="20" y="${H + 42}" fill="${S}">${r.size}${r.runs > 1 && r.type !== 'trench' ? ' (one shown)' : ''} · ${r.count} cables${r.fillPct ? ` · fill ${r.fillPct.toFixed(0)} %` : ''}</text></svg>`;
}
