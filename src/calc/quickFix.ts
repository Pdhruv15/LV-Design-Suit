import type { Feeder, Project } from '../types';
import { evaluateFeeder, runsOf, type FeederResult } from './electrical';
import { cables } from './cableTable';
import { breakerRatings, icuSteps } from './sizing';

/** Quick fixes for a circuit that fails a check: the smallest change that
 * makes it pass, each checked with the same calculation before it's offered. */
export interface QuickFix { label: string; patch: Partial<Feeder>; after: FeederResult }

const rank = { ok: 0, warn: 1, bad: 2 } as const;

/** Why a circuit fails, in words. */
export function failReasons(project: Project, r: FeederResult): string[] {
  const f = r.feeder, out: string[] = [];
  if (r.ampacityStatus === 'bad') out.push(`Cable too small: Iz ${r.ampacity.toFixed(0)} A < Ib ${r.ib.toFixed(0)} A`);
  if (r.ib > f.breakerRatingA) out.push(`Breaker too small: Ib ${r.ib.toFixed(0)} A > In ${f.breakerRatingA} A`);
  else if (r.protectionStatus === 'bad') out.push(`Cable not protected: In ${f.breakerRatingA} A > Iz ${r.ampacity.toFixed(0)} A`);
  if (r.vdStatus !== 'ok') out.push(`Voltage drop ${r.vdTotalPct.toFixed(2)} % (limit ${project.vdLimitPct} %)`);
  if (r.icuStatus === 'bad') out.push(`Breaking capacity: Icu ${f.breakerIcuKa} kA < fault ${r.breakerFaultKA.toFixed(1)} kA`);
  return out;
}

export function quickFixes(project: Project, f: Feeder): QuickFix[] {
  const now = evaluateFeeder(project, f);
  if (now.status === 'ok') return [];
  const out: QuickFix[] = [];
  const tryPatch = (label: string, patch: Partial<Feeder>) => {
    const after = evaluateFeeder(project, { ...f, ...patch });
    if (rank[after.status] < rank[now.status] && !out.some((x) => x.label === label)) out.push({ label, patch, after });
    return after;
  };
  // Breaker: the next rating at or above Ib (and its cable, if In then exceeds Iz).
  if (now.ib > f.breakerRatingA) {
    const In = breakerRatings().find((a) => a >= now.ib);
    if (In) {
      const a = tryPatch(`Breaker ${In} A`, { breakerRatingA: In });
      if (a.status !== 'ok') {
        const c = cables().find((c) => c.csaMm2 > f.cableCsaMm2 && evaluateFeeder(project, { ...f, breakerRatingA: In, cableCsaMm2: c.csaMm2, cpcMm2: undefined }).status === 'ok');
        if (c) tryPatch(`Breaker ${In} A + cable ${c.csaMm2} mm²`, { breakerRatingA: In, cableCsaMm2: c.csaMm2, cpcMm2: undefined });
      }
    }
  }
  // Breaker down: In between Ib and the cable's Iz (cable not protected).
  if (now.ib <= f.breakerRatingA && f.breakerRatingA > now.ampacity) {
    const In = [...breakerRatings()].reverse().find((a) => a >= now.ib && a <= now.ampacity);
    if (In) tryPatch(`Breaker ${In} A`, { breakerRatingA: In });
  }
  // Cable: the smallest larger size that passes (current, protection, voltage drop).
  const bigger = cables().find((c) => c.csaMm2 > f.cableCsaMm2 && evaluateFeeder(project, { ...f, cableCsaMm2: c.csaMm2, cpcMm2: undefined }).status === 'ok');
  if (bigger) tryPatch(`Cable ${bigger.csaMm2} mm²`, { cableCsaMm2: bigger.csaMm2, cpcMm2: undefined });
  // A parallel run (large cables, long runs).
  if (f.cableCsaMm2 >= 95 || now.vdStatus !== 'ok') tryPatch(`${runsOf(f) + 1} cables in parallel`, { parallel: runsOf(f) + 1 });
  // Breaking capacity: the next Icu at or above the fault level.
  if (now.icuStatus === 'bad') { const icu = icuSteps().find((k) => k >= now.breakerFaultKA); if (icu) tryPatch(`Breaker Icu ${icu} kA`, { breakerIcuKa: icu }); }
  return out.sort((a, b) => rank[a.after.status] - rank[b.after.status]).slice(0, 4);
}
