import { dxfText, type DxfPrimitive } from './dxf';

/** Paper-space boxes use a bottom-left origin, in mm. */
export interface DxfBox { x: number; y: number; w: number; h: number }

/** A stable footprint for fitted R12 text, independent of the installed font. */
export const textWidth = (value: string, height: number) => dxfText(value).length * height * 0.65;

export function wrapDxfText(value: string, width: number, height: number): string[] {
  const limit = Math.max(1, Math.floor(width / (height * 0.65)));
  const lines: string[] = [];
  for (const paragraph of value.split(/\r\n|[\r\n]/)) {
    let line = '';
    for (const word of dxfText(paragraph).trim().split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > limit) { lines.push(line); line = ''; }
      let rest = word;
      while (rest.length > limit) {
        if (line) { lines.push(line); line = ''; }
        lines.push(rest.slice(0, limit)); rest = rest.slice(limit);
      }
      if (rest) line += `${line ? ' ' : ''}${rest}`;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Emit editable, fitted text with cap height and descenders inside the box.
 * Fixed cells may fit multiple wrapped lines into one baseline; callers can
 * move excessive content onto a continuation sheet instead of compressing it. */
export function textInBox(layer: string, box: DxfBox, value: string, height: number, align: 'left' | 'center' | 'right' = 'left'): DxfPrimitive[] {
  if (![box.x, box.y, box.w, box.h, height].every(Number.isFinite) || box.w <= 0 || box.h <= 0 || height <= 0) return [];
  const cap = Math.min(height, box.h / 1.25);
  const lines = wrapDxfText(value, box.w, cap);
  const count = Math.max(1, Math.floor((box.h + cap * 0.25) / (cap * 1.5)));
  const group = Math.max(1, Math.ceil(lines.length / count));
  const out: DxfPrimitive[] = [];
  for (let j = 0; j < lines.length; j += group) {
    const text = lines.slice(j, j + group).join(' ');
    const width = Math.min(box.w, textWidth(text, cap));
    out.push({ type: 'text', layer, x: box.x + (align === 'center' ? box.w / 2 : align === 'right' ? box.w : 0), y: box.y + box.h - cap - out.length * cap * 1.5, height: cap, text, width, align });
  }
  return out;
}
