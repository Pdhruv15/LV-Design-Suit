/** Escaping for markup the app generates as strings (SVG drawings, report HTML).
 *
 * Every value that comes from a project file is untrusted: escape it for the
 * context it lands in. Text nodes: escapeHtmlText. Quoted attributes:
 * escapeHtmlAttr (also safe for text). Numbers placed in markup: num(), which
 * turns anything that is not a finite number into 0 so a string smuggled into a
 * numeric field can never reach the markup. Never use these for CSS selectors. */

const TEXT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const ATTR: Record<string, string> = { ...TEXT, '"': '&quot;', "'": '&#39;' };

export const escapeHtmlText = (v: unknown): string => String(v ?? '').replace(/[&<>]/g, (c) => TEXT[c]);
export const escapeHtmlAttr = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ATTR[c]);

/** A finite number for markup, else the fallback. */
export const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Largest logo accepted (decoded bytes). The app scales uploads down to a small PNG, far below this. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
/** A company logo the app can show: a PNG or JPEG data URL (the app re-encodes every upload as PNG), not too large.
 * SVG and other data URLs are refused — an SVG can carry scripts and links. */
export function isRasterDataUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^data:image\/(png|jpeg);base64,([a-z0-9+/]+={0,2})$/i.exec(v);
  return !!m && Math.floor((m[2].length * 3) / 4) <= MAX_LOGO_BYTES;
}
