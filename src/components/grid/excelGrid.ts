/** Excel-style behaviour for the app's own (Classic) tables, without a
 * spreadsheet library. Cells carry data-cell="row:col" on their input,
 * select, or on the <td> for read-only cells. Supports:
 *  - arrows / Enter / Shift+Enter to move (Left/Right at the edge of text),
 *  - Shift+arrows or mouse drag to select a block,
 *  - Ctrl/⌘ C copies the block as tab-separated text (pastes into Excel),
 *  - Ctrl/⌘ V pastes a block from Excel starting at the current cell,
 *  - Ctrl/⌘ D fills the top row of the block down,
 *  - Delete / Backspace on a block clears it.
 * Changes go out as edits; the table's owner validates and applies them. */

export interface GridEdit {
  y: number;
  x: number;
  value: string;
}

export interface Pos {
  y: number;
  x: number;
}

export const cellKey = (y: number, x: number) => `${y}:${x}`;
export const parseKey = (k: string | null): Pos | undefined => {
  const m = k?.match(/^(-?\d+):(\d+)$/);
  return m ? { y: Number(m[1]), x: Number(m[2]) } : undefined;
};

/** Tab-separated text (Excel's clipboard format) → rows of cells. */
export function parseClipboard(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l.split('\t'));
}

export const toClipboard = (rows: string[][]) => rows.map((r) => r.join('\t')).join('\n');

/** Rows and columns present in a table, in display order. */
export function axes(cells: Pos[]): { ys: number[]; xs: number[] } {
  return { ys: [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b), xs: [...new Set(cells.map((c) => c.x))].sort((a, b) => a - b) };
}

/** Edits for pasting a block with its top-left at `at`, following the
 * table's own row and column order (skipping gaps). */
export function pasteEdits(block: string[][], at: Pos, ys: number[], xs: number[]): GridEdit[] {
  const y0 = ys.indexOf(at.y);
  const x0 = xs.indexOf(at.x);
  if (y0 < 0 || x0 < 0) return [];
  const out: GridEdit[] = [];
  block.forEach((row, i) => row.forEach((value, j) => {
    const y = ys[y0 + i];
    const x = xs[x0 + j];
    if (y !== undefined && x !== undefined) out.push({ y, x, value });
  }));
  return out;
}

/** Block between two corners, in table order. */
export function blockOf(a: Pos, b: Pos, ys: number[], xs: number[]): Pos[] {
  const [y1, y2] = [ys.indexOf(a.y), ys.indexOf(b.y)].sort((p, q) => p - q);
  const [x1, x2] = [xs.indexOf(a.x), xs.indexOf(b.x)].sort((p, q) => p - q);
  const out: Pos[] = [];
  for (let i = y1; i <= y2; i++) for (let j = x1; j <= x2; j++) out.push({ y: ys[i], x: xs[j] });
  return out;
}

/** Fill down: each column's top value into the rows below it. */
export function fillDownEdits(block: Pos[], valueAt: (p: Pos) => string): GridEdit[] {
  const { ys, xs } = axes(block);
  return xs.flatMap((x) => {
    const top = valueAt({ y: ys[0], x });
    return ys.slice(1).map((y) => ({ y, x, value: top }));
  });
}
