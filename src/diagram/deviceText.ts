import type { Feeder } from '../types';

/** Poles as written on SLDs (DEWA wording): SP for a single phase, SPN, TP, TPN. */
export const devicePoles = (f: Feeder) => (f.phase && f.phase !== 'RYB' ? 'SP' : f.cores === 2 ? 'SPN' : f.cores === 3 ? 'TP' : 'TPN');

/** The protective device's kind: MCB up to 63 A unless set, else MCCB, or ACB. */
export const deviceKind = (f: Feeder) => { const t = f.breakerType ?? (f.breakerRatingA <= 63 ? 'C' : 'MCCB'); return t === 'ACB' ? 'ACB' : t === 'MCCB' ? 'MCCB' : 'MCB'; };
