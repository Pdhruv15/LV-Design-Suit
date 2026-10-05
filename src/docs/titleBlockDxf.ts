import type { Project } from '../types';
import type { TitleTemplate } from '../model/titleBlock';
import { fillParams, paramList } from '../model/params';
import type { DxfPrimitive } from './dxf';
import { textInBox, textWidth, type DxfBox } from './dxfLayout';

export interface TitleDetail { label: string; value: string }

/** Custom grids remain editable CAD geometry, including merged cells. */
export function templateTitleBlockDxf(template: TitleTemplate, project: Project, box: DxfBox, extra: Record<string, string>, history: { id: string; date: string; description: string }[]): { items: DxfPrimitive[]; warnings: string[]; details: TitleDetail[] } {
  if (!template.cols.length || !template.rows.length || [...template.cols, ...template.rows].some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('The title block needs positive row heights and column widths.');
  const totalW = template.cols.reduce((a, b) => a + b, 0), totalH = template.rows.reduce((a, b) => a + b, 0);
  const scale = Math.min(box.w / totalW, box.h / totalH);
  const xs = [box.x], ys = [box.y + box.h];
  template.cols.forEach((v) => xs.push(xs[xs.length - 1] + v * scale));
  template.rows.forEach((v) => ys.push(ys[ys.length - 1] - v * scale));
  const items: DxfPrimitive[] = [], warnings: string[] = [], details: TitleDetail[] = [];
  const covered = new Set<string>();
  const params = paramList(project);
  const frame = (b: DxfBox) => items.push({ type: 'polyline', layer: 'E-TITLE', closed: true, points: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] });
  const bounded = (b: DxfBox, value: string, height: number, label: string, align: 'left' | 'center' | 'right' = 'left') => {
    let text = textInBox('E-TITLE', b, value, height, align);
    if ((value.trim() && !text.length) || text.some((p) => p.type === 'text' && ((p.width ?? 0) < textWidth(p.text, p.height) * 0.55 || p.height < Math.min(1.5, height * 0.75)))) {
      const reference = details.length + 1;
      details.push({ label: `[${reference}] ${label}`, value });
      const marker = textWidth(`[${reference}]`, height) <= b.w ? `[${reference}]` : String(reference);
      text = textInBox('E-TITLE', b, marker, height, align);
      warnings.push('Some title-block cells are too small; see the numbered entries in TITLE BLOCK DETAILS for their full values.');
    }
    items.push(...text);
  };
  for (const c of template.cells) {
    const rs = c.rs ?? 1, cs = c.cs ?? 1;
    if (![c.r, c.c, rs, cs].every(Number.isInteger) || c.r < 0 || c.c < 0 || rs < 1 || cs < 1 || c.r + rs > template.rows.length || c.c + cs > template.cols.length) throw new Error('A title-block cell is outside its grid.');
    for (let r = c.r; r < c.r + rs; r++) for (let col = c.c; col < c.c + cs; col++) {
      const key = `${r},${col}`;
      if (covered.has(key)) throw new Error('Title-block cells overlap.');
      covered.add(key);
    }
    const cell = { x: xs[c.c], y: ys[c.r + rs], w: xs[c.c + cs] - xs[c.c], h: ys[c.r] - ys[c.r + rs] };
    frame(cell);
    const pad = Math.min(1.2 * scale, cell.w / 6, cell.h / 6);
    const inside = { x: cell.x + pad, y: cell.y + pad, w: cell.w - 2 * pad, h: cell.h - 2 * pad };
    if (c.caption) {
      const ch = Math.min(3 * scale, inside.h * 0.4);
      bounded({ ...inside, y: inside.y + inside.h - ch, h: ch }, c.caption.toUpperCase(), 1.5 * scale, `${c.caption} caption`);
      inside.h -= ch;
    }
    if (c.kind === 'logo') {
      if (project.drawing?.logo?.startsWith('data:image/')) {
        bounded(inside, 'LOGO', 2 * scale, 'Logo', 'center');
        warnings.push('DXF uses a LOGO placeholder; raster logos are available in the PDF.');
      }
    } else if (c.kind === 'revisions') {
      const rows = history.length ? history : [{ id: '-', date: '', description: 'Not issued' }];
      const rowH = inside.h / rows.length;
      rows.forEach((r, j) => bounded({ ...inside, y: inside.y + inside.h - (j + 1) * rowH, h: rowH }, `${r.id}  ${r.date}  ${r.description}`, 1.8 * scale, `Revision ${r.id}`));
    } else {
      bounded(inside, fillParams(c.text, project, extra, params), (c.size && Number.isFinite(c.size) && c.size > 0 ? c.size : 8) * 0.3528 * scale, c.caption || `Title cell ${c.r + 1}/${c.c + 1}`, c.align);
    }
  }
  // Empty positions retain the grid border rather than disappearing in CAD.
  template.rows.forEach((_, r) => template.cols.forEach((_, c) => {
    if (!covered.has(`${r},${c}`)) frame({ x: xs[c], y: ys[r + 1], w: xs[c + 1] - xs[c], h: ys[r] - ys[r + 1] });
  }));
  return { items, warnings: [...new Set(warnings)], details };
}
