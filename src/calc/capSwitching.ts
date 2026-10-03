import type { Feeder } from '../types';

/** Capacitor banks on the SLD are automatic banks: an APFC relay on the board switches whole steps
 * (bank kvar ÷ capSteps). At the design load it switches the fewest steps that bring the board to the
 * PF target without going leading; if none does, the most steps that keep the board lagging (Q ≥ 0).
 * The design calculations count that switched kvar, not the full installed rating (which still sets
 * the bank's own breaker and cable). Several banks on one board switch in turn. */
export function switchedKvar(p: number, q: number, bankKvar: number, steps = 1, targetPf = 0.95): number {
  const n = Math.max(1, Math.round(steps));
  const step = bankKvar / n;
  const target = Math.min(Math.max(targetPf, 0.5), 1);
  const ok = (k: number) => { const qa = q - k * step; const s = Math.hypot(p, qa); return { lag: qa >= -1e-9, pf: s > 0 ? p / s : 1 }; };
  for (let k = 0; k <= n; k++) { const x = ok(k); if (x.lag && x.pf >= target - 1e-9) return k * step; }
  let best = 0;
  for (let k = 0; k <= n; k++) if (ok(k).lag) best = k;
  return best * step;
}

/** kvar each capacitor bank on a board is counted at, given the board's P and Q without its banks.
 * A bank with no step count is a fixed capacitor: always on at its full kvar (it can make the board
 * leading). A bank with steps (1 or more) is automatic: fixed banks first, then the automatic ones switch. */
export function switchedOnBoard(caps: Feeder[], p: number, q: number, targetPf: number): Map<string, number> {
  const out = new Map<string, number>();
  let rest = q;
  for (const c of caps.filter((x) => !x.capSteps)) { out.set(c.id, c.kvar ?? 0); rest -= c.kvar ?? 0; }
  for (const c of caps.filter((x) => x.capSteps)) {
    const k = switchedKvar(p, rest, c.kvar ?? 0, c.capSteps, targetPf);
    out.set(c.id, k);
    rest -= k;
  }
  return out;
}
