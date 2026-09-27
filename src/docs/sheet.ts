/** Shared shape of the form sheets (DB load schedule, connected load & MD):
 * what the grid draws and how typed values come back. */

export interface SheetColumnSpec {
  title: string;
  width: number;
  /** User input column. */
  input: boolean;
  /** Choices, for dropdown columns. */
  source?: string[];
  align?: 'left' | 'center';
  wrap?: boolean;
}

export interface SheetModel {
  cols: SheetColumnSpec[];
  data: (string | number)[][];
  /** Top-left cell name → [columns, rows] spanned. */
  merges: Record<string, [number, number]>;
  /** Header groups above the column titles. */
  groups: { title: string; colspan: number }[];
  /** Totals line under the grid, one cell per column. */
  totals?: string[];
  /** Cell name → CSS. */
  styles: Record<string, string>;
  /** Changes when rows, columns or merges change (the grid is rebuilt);
   * otherwise only values are refreshed. */
  shape: string;
  editable: (y: number, x: number) => boolean;
  /** Columns kept in view while scrolling right. */
  freezeColumns?: number;
}

export interface SheetEdit {
  y: number;
  x: number;
  value: string | number | boolean;
}

/** Spreadsheet column name for a 0-based index: 0 → A, 26 → AA. */
export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export const cellName = (x: number, y: number) => `${colName(x)}${y + 1}`;

/** Paper-form cell colours: white inputs, grey calculated cells. */
export const STYLE = {
  input: 'background-color:#ffffff',
  calc: 'background-color:#eef1f5;color:#26303d',
  muted: 'background-color:#f3f5f8;color:#9aa6b8',
  label: 'background-color:#e9edf3;font-weight:700;color:#17202e;text-align:left',
  highlight: 'background-color:#fff6d6;font-weight:600',
  vertical: 'writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-size:11px'
};

export const statusColor = (s: string) => (s === 'bad' ? '#c21f32' : s === 'warn' ? '#a86500' : '#13803d');

/** Whole, non-negative number; blank is 0. */
export function parseCount(v: string): number | null {
  const t = v.trim();
  if (t === '') return 0;
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Positive number, decimal point or comma. */
export function parsePositive(v: string): number | null {
  const t = v.trim().replace(',', '.');
  return /^\d*\.?\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
}
