import type { Board, Feeder, Project } from '../types';
import { FORM4_COLUMNS, type Form4Counts } from '../calc/form4';
import { roleOf } from './emergency';
import { spareBreaker, spareWaysOf } from './spareWays';

/** Boards sized with the Form-4 worksheet: main and sub-main boards (normal and emergency). */
export const FORM4_ROLES = ['LV-ACB', 'MDB', 'SMDB', 'LV-EMDB', 'EMDB', 'ESMDB'];
export const isForm4Board = (p: Project, b: Board) => FORM4_ROLES.includes(roleOf(p, b));

/** One breaker of the board and the worksheet column it was counted in. */
export interface Form4Item {
  what: string; // feeder or incomer name
  ratingA: number;
  column: string;
  note?: string; // why it went there, when not a plain match
}

const col = (id: string) => FORM4_COLUMNS.find((c) => c.id === id)!;
const isAcb = (f: Feeder) => f.device === 'ACB' || f.breakerType === 'ACB';

/** Riser columns by rating (feeders of 800 A and above to another board). */
function riserColumn(f: Feeder): [string, string?] {
  const a = f.breakerRatingA;
  if (a > 2500) return ['F', `${a} A is above the worksheet's 2500 A riser`];
  if (a > 2000) return ['F'];
  if (a > 1600) return ['G'];
  if (a > 1250) return ['H'];
  if (a > 1000) return isAcb(f) ? ['I'] : ['J'];
  if (a === 1000) return isAcb(f) ? ['I', 'ACB counted in the 1250 A ACB cubicle'] : ['J'];
  return ['K'];
}

function capacitorColumn(f: Feeder): [string, string?] {
  const a = f.breakerRatingA;
  if (a > 1250) return ['L', `${a} A is above the worksheet's 1250 A capacitor breaker`];
  if (a > 800) return isAcb(f) ? ['L'] : ['M'];
  if (a > 630) return ['N'];
  return ['O', a < 630 ? `${a} A counted in the 630 A capacitor cubicle` : undefined];
}

function outgoingColumn(f: Feeder): [string, string?] {
  const a = f.breakerRatingA;
  if (a > 1250) return ['P', `${a} A is above the worksheet's 1250 A outgoing`];
  if (a > 1000) return ['P'];
  if (a > 800) return isAcb(f) ? ['P', 'ACB counted in the 1250 A ACB cubicle'] : ['Q'];
  if (a > 630) return ['R'];
  if (a > 400) return ['S'];
  if (a > 250) return ['T'];
  if (a > 160) return ['U'];
  if (a > 100) return ['V'];
  return ['X'];
}

/** The board's incomer rating: its feeder from the board above, else the authority supply or busbar rating. */
export function form4IncomerA(p: Project, b: Board): number | undefined {
  return p.feeders.find((f) => f.feedsBoardId === b.id)?.breakerRatingA ?? b.supply?.ratingA ?? b.ratedCurrentA;
}

/** The worksheet quantities from the board's breakers on the SLD.
 * Harmonic feeders are not marked on the SLD: enter them by hand. */
export function form4FromSld(p: Project, boardId: string): { counts: Form4Counts; items: Form4Item[]; notes: string[] } {
  const b = p.boards.find((x) => x.id === boardId);
  const counts: Form4Counts = {};
  const items: Form4Item[] = [];
  const notes: string[] = [];
  if (!b) return { counts, items, notes };
  const put = (what: string, ratingA: number, [id, note]: [string, string?]) => {
    counts[id] = (counts[id] ?? 0) + 1;
    items.push({ what, ratingA, column: id, ...(note ? { note } : {}) });
  };

  const inA = form4IncomerA(p, b);
  if (inA === undefined) notes.push('No incomer rating on the SLD — enter the incomer by hand.');
  else {
    const inCol: [string, string?] = inA > 2500 ? ['D', `${inA} A is above the worksheet's 2500 A incomer`] : inA > 1600 ? ['D'] : ['E', inA < 1600 ? `${inA} A counted in the 1600 A ACB cubicle` : undefined];
    put('Incomer (mains)', inA, inCol);
    // Mains and generator ACBs, interlocked: a second incomer cubicle.
    if (b.standby?.changeover === 'ACB') put('Incomer (generator)', inA, inCol);
  }

  for (const f of p.feeders.filter((x) => x.boardId === b.id)) {
    const a = f.breakerRatingA;
    if (f.loadType === 'capacitor') put(f.name, a, capacitorColumn(f));
    else if (f.feedsBoardId && a >= 800) put(f.name, a, riserColumn(f));
    else put(f.name, a, outgoingColumn(f));
  }
  // Spare breakers fill outgoing cubicles like any other; a space is left to the spare-capacity allowance.
  for (const s of spareWaysOf(b)) if (s.kind === 'spare') put('Spare', s.ratingA, outgoingColumn(spareBreaker(b, s)));
  const spaces = spareWaysOf(b).filter((s) => s.kind === 'space').length;
  if (spaces) notes.push(`${spaces} space${spaces === 1 ? '' : 's'} on the panel (no breaker) — not counted; add a cubicle by hand if the space needs one.`);
  if (items.some((x) => col(x.column).group === 'riser')) notes.push('Feeders of 800 A and above to another board are counted as bus bar risers. If one is cabled, move it to the outgoings by hand.');
  return { counts, items, notes };
}
