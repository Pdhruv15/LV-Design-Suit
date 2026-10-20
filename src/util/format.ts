/** Numbers for the screen: thousands separators, '—' when there is no value. */

/** Up to `d` decimals, trailing zeros dropped (12.5, 3). */
export const fmtUpTo = (v: number | undefined, d = 2) =>
  v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** Exactly `d` decimals (1,250, 0.85). */
export const fmtFixed = (v: number | undefined, d = 0) =>
  v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
