import { routeSettings, type TrayLine, type TrayResult } from '../calc/cableTray';
import type { TrayPlan } from '../types';

/** Cable tray cross-section, to scale: each tier with its cables laid
 * largest first (single layer with the spacing, or packed in rows for the
 * fill method), the spare width hatched, and the dimensions. Returned as
 * a self-contained SVG string, for the screen and the PDF. */

/** Cable numbers as in the schedule: 1, 2, 3…; an ECC takes its cable's number + "E". */
export function lineNumbers(lines: TrayLine[]): Map<string, string> {
  const m = new Map<string, string>();
  let n = 0;
  let last = '';
  for (const l of lines) {
    if (l.ecc) m.set(l.id, `${last}E`);
    else { last = String(++n); m.set(l.id, last); }
  }
  return m;
}

interface Placed { x: number; y: number; d: number; label: string; }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function traySectionSvg(res: TrayResult, plan: TrayPlan, maxPx = 560): string {
  const s = routeSettings(plan, res.route);
  const nums = lineNumbers(res.lines);
  const W = res.widthMm;
  const D = res.depthMm;
  const tiers = Math.max(1, res.tiers);
  const cables = res.laid.map((c) => ({ d: c.odMm, label: nums.get(c.lineId) ?? '' }));

  // Share the cables between the tiers, largest first.
  const perTier: { d: number; label: string }[][] = Array.from({ length: tiers }, () => []);
  if (s.method === 'fill') {
    const total = cables.reduce((a, c) => a + c.d * c.d, 0);
    let t = 0, acc = 0;
    for (const c of cables) {
      if (t < tiers - 1 && acc >= (total / tiers) * (t + 1)) t++;
      perTier[t].push(c);
      acc += c.d * c.d;
    }
  } else {
    const gapOf = (prev: number) => (s.spacing === 'mm' ? s.spacingMm : prev * ({ touching: 0, quarter: 0.25, half: 0.5, one: 1, two: 2 } as const)[s.spacing]);
    const target = res.occupiedMm / tiers;
    let t = 0, w = 0, prev = 0;
    for (const c of cables) {
      const need = (w > 0 ? gapOf(prev) : 0) + c.d;
      if (t < tiers - 1 && w > 0 && w + need > target + c.d / 2) { t++; w = 0; }
      w += (w > 0 ? gapOf(prev) : 0) + c.d;
      prev = c.d;
      perTier[t].push(c);
    }
  }

  // Place each tier's cables (mm, origin at the tray's inside bottom-left, y up).
  const placedTiers: { cables: Placed[]; used: number; height: number }[] = perTier.map((list) => {
    const out: Placed[] = [];
    if (s.method === 'fill') {
      let x = 0, base = 0, rowH = 0;
      for (const c of list) {
        if (x > 0 && x + c.d > W) { base += rowH; x = 0; rowH = 0; }
        out.push({ x: x + c.d / 2, y: base + c.d / 2, d: c.d, label: c.label });
        x += c.d;
        rowH = Math.max(rowH, c.d);
      }
      const used = out.reduce((a, p) => Math.max(a, p.x + p.d / 2), 0);
      return { cables: out, used, height: base + rowH };
    }
    let x = 0, prev = 0;
    for (const c of list) {
      const gap = x > 0 ? (s.spacing === 'mm' ? s.spacingMm : prev * ({ touching: 0, quarter: 0.25, half: 0.5, one: 1, two: 2 } as const)[s.spacing]) : 0;
      x += gap;
      out.push({ x: x + c.d / 2, y: c.d / 2, d: c.d, label: c.label });
      x += c.d;
      prev = c.d;
    }
    return { cables: out, used: x, height: list.reduce((a, c) => Math.max(a, c.d), 0) };
  });

  const maxUsed = Math.max(W, ...placedTiers.map((t) => t.used));
  const k = Math.min(4, maxPx / maxUsed); // px per mm
  const padL = 34, padR = 12, padT = 18, labelH = 30;
  const tierInner = placedTiers.map((t) => Math.max(D, t.height) * k);
  const tierH = tierInner.map((h) => h + labelH + 14);
  const width = padL + maxUsed * k + padR;
  const height = padT + tierH.reduce((a, b) => a + b, 0) + 6;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}" font-family="Arial, sans-serif">`);
  parts.push('<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#9ec5a8" stroke-width="2"/></pattern></defs>');
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  // Tiers from top to bottom: tier 1 is the top one, as usually drawn.
  let top = padT;
  placedTiers.forEach((t, i) => {
    const inner = tierInner[i];
    const bottom = top + inner;
    const x0 = padL, x1 = padL + W * k;
    const wall = D * k;
    // Spare width (after the last cable, inside the tray).
    if (t.used < W) parts.push(`<rect x="${(x0 + t.used * k).toFixed(1)}" y="${(bottom - wall).toFixed(1)}" width="${((W - t.used) * k).toFixed(1)}" height="${wall.toFixed(1)}" fill="url(#hatch)" opacity="0.7"/>`);
    // Tray: side walls and bottom.
    parts.push(`<path d="M${x0} ${(bottom - wall).toFixed(1)} V${bottom.toFixed(1)} H${x1.toFixed(1)} V${(bottom - wall).toFixed(1)}" fill="none" stroke="#26303d" stroke-width="2.5"/>`);
    for (const c of t.cables) {
      const cx = x0 + c.x * k, cy = bottom - c.y * k, r = (c.d / 2) * k;
      const over = c.x + c.d / 2 > W + 1e-6;
      parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(0.8, r - 0.4).toFixed(1)}" fill="${over ? '#f6c9cf' : c.label.endsWith('E') ? '#d9f0dc' : '#dbe6f5'}" stroke="${over ? '#c21f32' : '#3b5b86'}" stroke-width="1"/>`);
      if (r >= 6.5) parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + Math.min(r * 0.45, 4)).toFixed(1)}" text-anchor="middle" style="fill:#17202e;font:${Math.min(11, r).toFixed(1)}px Arial,sans-serif">${esc(c.label)}</text>`);
    }
    // Dimensions.
    parts.push(`<text x="${((x0 + x1) / 2).toFixed(1)}" y="${(bottom + 14).toFixed(1)}" text-anchor="middle" style="fill:#26303d;font:11px Arial,sans-serif">${W} mm${tiers > 1 ? ` — tier ${i + 1} of ${tiers}` : ''}${t.used > W ? ' — cables do not fit' : ''}</text>`);
    parts.push(`<text x="${padL - 6}" y="${(bottom - wall / 2 + 4).toFixed(1)}" text-anchor="end" style="fill:#6a7689;font:10px Arial,sans-serif">${D}</text>`);
    top += tierH[i];
  });
  parts.push('</svg>');
  return parts.join('');
}
