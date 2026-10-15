/** Form-4 MDB / SMDB enclosure sizing (incoming and outgoing bottom entry).
 *
 * The rules of the owner's worksheet "LV PANEL SIZE SELECTION.xlsx", sheet
 * "FORM-4 Design Work Sheet", term by term:
 *
 *   W = Σ (qty × cubicle width) for incomers, risers, capacitor bank and the large outgoings
 *     + 300 riser cable chamber, when there is any riser
 *     + 600 first outgoing section, when there is any stacked outgoing
 *     + 300 outgoing cable chamber, when there are stacked outgoings and no riser
 *     + 900 per extra outgoing section, when the stacked heights pass 1800 mm
 *       (INT((stack − 1801) / 1800 + 1) sections), less 300 once when there is no riser
 *   H = 2100 + 100 plinth, D = 800 — fixed, whatever the ratings.
 *
 * A preliminary space estimate: busbar sizing, shipping splits, temperature rise and the
 * panel builder's own layout are separate. */

export type Form4Group = 'incomer' | 'riser' | 'capacitor' | 'outgoing' | 'stacked';

/** One column of the worksheet. Cubicle devices have a width; stacked outgoings a height in the 600 mm section. */
export interface Form4Column {
  id: string; // the worksheet column letter
  group: Form4Group;
  label: string;
  device: 'ACB' | 'MCCB' | 'Harmonic';
  /** Ratings the column covers, as the worksheet writes them. */
  ratings: number[];
  poles?: '4P' | 'TP';
  widthMm?: number;
  heightMm?: number;
  /** Short text on the front view. */
  short: string;
}

export const FORM4_COLUMNS: Form4Column[] = [
  { id: 'D', group: 'incomer', label: '2500 A 4P ACB', device: 'ACB', ratings: [2500], poles: '4P', widthMm: 800, short: '2500' },
  { id: 'E', group: 'incomer', label: '1600 A 4P ACB', device: 'ACB', ratings: [1600], poles: '4P', widthMm: 800, short: '1600' },
  { id: 'F', group: 'riser', label: '2500 A TP ACB', device: 'ACB', ratings: [2500], poles: 'TP', widthMm: 800, short: '2500' },
  { id: 'G', group: 'riser', label: '2000 A TP ACB', device: 'ACB', ratings: [2000], poles: 'TP', widthMm: 800, short: '2000' },
  { id: 'H', group: 'riser', label: '1600 A TP ACB', device: 'ACB', ratings: [1600], poles: 'TP', widthMm: 800, short: '1600' },
  { id: 'I', group: 'riser', label: '1250 A TP ACB', device: 'ACB', ratings: [1250], poles: 'TP', widthMm: 800, short: '1250' },
  { id: 'J', group: 'riser', label: '1250 / 1000 A TP MCCB', device: 'MCCB', ratings: [1250, 1000], poles: 'TP', widthMm: 600, short: '1250' },
  { id: 'K', group: 'riser', label: '800 A TP MCCB', device: 'MCCB', ratings: [800], poles: 'TP', widthMm: 600, short: '800' },
  { id: 'L', group: 'capacitor', label: '1250 A TP ACB', device: 'ACB', ratings: [1250], poles: 'TP', widthMm: 800, short: 'C 1250' },
  { id: 'M', group: 'capacitor', label: '1250 / 1000 A TP MCCB', device: 'MCCB', ratings: [1250, 1000], poles: 'TP', widthMm: 500, short: 'C 1250' },
  { id: 'N', group: 'capacitor', label: '800 A TP MCCB', device: 'MCCB', ratings: [800], poles: 'TP', widthMm: 500, short: 'C 800' },
  { id: 'O', group: 'capacitor', label: '630 A TP MCCB', device: 'MCCB', ratings: [630], poles: 'TP', widthMm: 500, short: 'C 630' },
  { id: 'P', group: 'outgoing', label: '1250 A ACB', device: 'ACB', ratings: [1250], widthMm: 800, short: '1250' },
  { id: 'Q', group: 'outgoing', label: '1000 A MCCB', device: 'MCCB', ratings: [1000], widthMm: 500, short: '1000' },
  { id: 'R', group: 'outgoing', label: '800 A MCCB', device: 'MCCB', ratings: [800], widthMm: 500, short: '800' },
  { id: 'S', group: 'stacked', label: '630 / 500 A MCCB', device: 'MCCB', ratings: [630, 500], heightMm: 400, short: '630 A' },
  { id: 'T', group: 'stacked', label: '400 / 350 / 300 A MCCB', device: 'MCCB', ratings: [400, 350, 300], heightMm: 300, short: '400 A' },
  { id: 'U', group: 'stacked', label: '250 / 225 / 200 A MCCB', device: 'MCCB', ratings: [250, 225, 200], heightMm: 250, short: '250 A' },
  { id: 'V', group: 'stacked', label: '160 / 125 A MCCB', device: 'MCCB', ratings: [160, 125], heightMm: 200, short: '160 A' },
  { id: 'W', group: 'stacked', label: 'Harmonic feeder', device: 'Harmonic', ratings: [], heightMm: 200, short: 'HF' },
  { id: 'X', group: 'stacked', label: 'Up to 100 A MCCB', device: 'MCCB', ratings: [100], heightMm: 200, short: '≤100 A' }
];

export const FORM4_GROUPS: { id: Form4Group; label: string }[] = [
  { id: 'incomer', label: 'Incomer (DEWA / generator)' },
  { id: 'riser', label: 'Bus bar riser' },
  { id: 'capacitor', label: 'Capacitor bank' },
  { id: 'outgoing', label: 'Outgoings — full-width cubicles' },
  { id: 'stacked', label: 'Outgoings — stacked in a 600 mm section (1800 mm usable height)' }
];

export const FORM4_SOURCE = 'LV PANEL SIZE SELECTION.xlsx — FORM-4 Design Work Sheet';
export const FORM4_REVISION = '1';
export const FORM4_HEIGHT = 2100;
export const FORM4_PLINTH = 100;
export const FORM4_DEPTH = 800;
export const FORM4_STACK = 1800; // usable height of a stacked outgoing section

/** Quantity per worksheet column (missing = 0). */
export type Form4Counts = Partial<Record<string, number>>;

export interface Form4Part {
  label: string;
  mm: number;
  kind: 'device' | 'chamber' | 'section';
  column?: Form4Column;
  qty?: number;
}

export interface Form4Result {
  widthMm: number;
  dims: { h: number; w: number; d: number; plinth: number };
  /** Width items in the order they stand in the line-up, summing to widthMm. */
  parts: Form4Part[];
  stackMm: number;
  sections: number; // stacked outgoing sections (0 when none)
  riser: boolean;
}

const qtyOf = (c: Form4Counts, id: string) => Math.max(0, Math.floor(c[id] ?? 0));

export function sizeForm4(counts: Form4Counts): Form4Result {
  const parts: Form4Part[] = [];
  const cols = (g: Form4Group) => FORM4_COLUMNS.filter((c) => c.group === g);
  const any = (g: Form4Group) => cols(g).some((c) => qtyOf(counts, c.id) > 0);
  const devices = (g: Form4Group) => {
    for (const c of cols(g)) {
      const qty = qtyOf(counts, c.id);
      if (qty) parts.push({ label: `${qty} × ${c.label}`, mm: qty * c.widthMm!, kind: 'device', column: c, qty });
    }
  };
  const riser = any('riser');
  const stacked = any('stacked');
  const stackMm = cols('stacked').reduce((s, c) => s + qtyOf(counts, c.id) * c.heightMm!, 0);
  const extra = stackMm > FORM4_STACK ? Math.floor((stackMm - (FORM4_STACK + 1)) / FORM4_STACK + 1) : 0;

  devices('incomer');
  devices('riser');
  if (riser) parts.push({ label: 'Riser cable chamber', mm: 300, kind: 'chamber' });
  devices('capacitor');
  devices('outgoing');
  if (stacked) {
    parts.push({ label: 'Outgoing section 1', mm: 600, kind: 'section' });
    // No riser: the worksheet's +300 chamber and −300 cancel once extra sections are needed.
    if (!riser && extra === 0) parts.push({ label: 'Outgoing cable chamber', mm: 300, kind: 'chamber' });
    for (let i = 0; i < extra; i++) {
      parts.push({ label: `Outgoing section ${i + 2}`, mm: 600, kind: 'section' });
      parts.push({ label: 'Cable chamber', mm: 300, kind: 'chamber' });
    }
  }
  const widthMm = parts.reduce((s, p) => s + p.mm, 0);
  return { widthMm, dims: { h: FORM4_HEIGHT, w: widthMm, d: FORM4_DEPTH, plinth: FORM4_PLINTH }, parts, stackMm, sections: stacked ? 1 + extra : 0, riser };
}

/** The stacked devices placed into their 1800 mm sections, in worksheet order (for the front view). */
export function stackSections(counts: Form4Counts, sections: number): Form4Column[][] {
  const out: Form4Column[][] = Array.from({ length: sections }, () => []);
  const used = out.map(() => 0);
  let s = 0;
  for (const c of FORM4_COLUMNS.filter((x) => x.group === 'stacked')) {
    for (let n = qtyOf(counts, c.id); n > 0; n--) {
      while (s < sections - 1 && used[s] + c.heightMm! > FORM4_STACK) s++;
      out[s]?.push(c);
      used[s] += c.heightMm!;
    }
  }
  return out;
}

/** What Design → Enclosure sizing saves on an MDB / SMDB: a frozen copy with the worksheet revision. */
export interface Form4Selection {
  revision: string;
  counts: Form4Counts;
  /** Counted from the SLD, or with quantities changed by hand. */
  method: 'sld' | 'manual';
  dims: { h: number; w: number; d: number; plinth: number };
  selectedOn: string;
}

export function form4Selection(counts: Form4Counts, method: Form4Selection['method']): Form4Selection {
  const clean: Form4Counts = {};
  for (const c of FORM4_COLUMNS) if (qtyOf(counts, c.id)) clean[c.id] = qtyOf(counts, c.id);
  return { revision: FORM4_REVISION, counts: clean, method, dims: sizeForm4(clean).dims, selectedOn: new Date().toISOString().slice(0, 10) };
}

export const form4SizeText = (d: Form4Selection['dims']) => `H${d.h} + ${d.plinth} plinth × W${d.w} × D${d.d} mm`;
