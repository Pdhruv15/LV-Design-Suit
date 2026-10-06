import type { Feeder } from '../types';
import { isMotor, starterInfo, starterOf } from '../calc/motor';

/** Boxed devices drawn on a feeder in the SLD: the motor starter and the earth leakage device. */
export interface SldDevices {
  starter?: string; // box label: DOL, S/D, SS, VFD
  elcb?: { label: string; ma?: number };
  extras: string[]; // UVR, TIMER — set from the load schedule remarks
}

const STARTER_WORDS: [RegExp, Feeder['starter']][] = [
  [/\bDOL\b/i, 'DOL'], [/\b(S\/D|STAR[- ]?DELTA|SD)\b/i, 'SD'], [/\b(SOFT[- ]?STARTER|SS)\b/i, 'SS'], [/\bVFD\b/i, 'VFD']
];

/**
 * What to box on a feeder. The feeder's own settings give the defaults (motor starter, earth leakage
 * rating); the load schedule remarks override them, e.g. "ELCB 30mA", "RCBO 100mA", "VFD", "S/D",
 * or "NO ELCB" / "NO STARTER" to suppress one; "UVR" and "TIMER" add those boxes.
 */
export function sldDevices(f: Feeder): SldDevices {
  const remarks = f.remarks ?? '';
  const out: SldDevices = { extras: [] };
  if (/\bUVR\b/i.test(remarks)) out.extras.push('UVR');
  if (/\bTIMER\b/i.test(remarks)) out.extras.push('TIMER');

  let starter = isMotor(f) ? starterOf(f) : undefined;
  if (/\bNO\s+STARTER\b/i.test(remarks)) starter = undefined;
  else for (const [re, s] of STARTER_WORDS) if (s && re.test(remarks)) { starter = s; break; }
  if (starter) out.starter = starterInfo(starter).short;

  const m = remarks.match(/\b(ELCB|RCCB|RCBO|RCD|ELR)\b(?:\s*[-:@]?\s*(\d+(?:\.\d+)?)\s*mA)?/i);
  if (/\bNO\s+(ELCB|RCCB|RCBO|RCD)\b/i.test(remarks)) return out;
  if (m) {
    const ma = m[2] ? Number(m[2]) : f.rcdMa;
    out.elcb = { label: m[1].toUpperCase() === 'ELR' ? 'ELR' : m[1].toUpperCase(), ma };
  } else if (f.rcdMa) out.elcb = { label: 'ELCB', ma: f.rcdMa };
  return out;
}
