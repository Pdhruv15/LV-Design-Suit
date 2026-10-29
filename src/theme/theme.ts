/** Screen colour theme. Only changes how the app looks on screen: drawings,
 * PDFs and DXF are always produced from the dark palette (see withPrintTheme). */

export type ThemePref = 'dark' | 'light' | 'system';
type Resolved = 'dark' | 'light';

export const THEME_LABEL: Record<ThemePref, string> = { dark: 'Dark', light: 'Light', system: 'Match system' };

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null);

export function resolveTheme(pref: ThemePref | undefined): Resolved {
  if (pref === 'light') return 'light';
  if (pref === 'system') return media()?.matches ? 'light' : 'dark';
  return 'dark';
}

/** Dark is the stylesheet default, so it is written as no attribute at all. */
function setResolved(t: Resolved) {
  const el = document.documentElement;
  if ((el.getAttribute('data-theme') === 'light') === (t === 'light')) return;
  // Switch instantly: hover transitions would otherwise fade every button between palettes.
  el.classList.add('theme-switching');
  if (t === 'light') el.setAttribute('data-theme', 'light');
  else el.removeAttribute('data-theme');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('theme-switching')));
}

let unwatch: (() => void) | null = null;

/** Apply a preference now and, for "Match system", follow later OS changes. */
export function applyTheme(pref: ThemePref | undefined) {
  if (typeof document === 'undefined') return;
  unwatch?.();
  unwatch = null;
  setResolved(resolveTheme(pref));
  const m = media();
  if (pref === 'system' && m) {
    const on = () => setResolved(resolveTheme('system'));
    m.addEventListener('change', on);
    unwatch = () => m.removeEventListener('change', on);
  }
}

/** The theme on screen now. */
export function screenTheme(): Resolved {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** Call `on` when the screen theme changes (Preferences, or the OS under "Match system"), for drawing that reads
 * colours once instead of through CSS, such as a canvas. withPrintTheme's switch and back is not a change.
 * Returns the unsubscribe. */
export function onScreenThemeChange(on: (t: Resolved) => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  let last = screenTheme();
  const mo = new MutationObserver(() => {
    const now = screenTheme();
    if (now !== last) { last = now; on(now); }
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

/** Run `read` with the dark palette in force, then restore the screen theme.
 * Export code reads live computed colours and maps the dark palette to
 * black-on-white print colours; this keeps that mapping (and so every exported
 * drawing) identical whichever theme is on screen. Synchronous, so the switch is
 * never painted. */
export function withPrintTheme<T>(read: () => T): T {
  if (typeof document === 'undefined') return read();
  const el = document.documentElement;
  const prev = el.getAttribute('data-theme');
  if (prev === null) return read();
  el.removeAttribute('data-theme');
  try {
    return read();
  } finally {
    el.setAttribute('data-theme', prev);
  }
}
