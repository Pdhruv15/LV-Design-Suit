import DOMPurify from 'dompurify';

/** Sanitizing for generated SVG / HTML before it is put into the page.
 *
 * The drawings and the title block are built as strings that include project
 * data. They are escaped where they are built (util/escape); this is the second
 * line: a DOM sanitizer (DOMPurify) at every innerHTML sink, configured so the
 * result can hold no script, event handler, foreign content, external URL or
 * style element — only shapes, text and inline styles. Images are allowed only
 * as raster data URLs (the company logo). */

const RASTER_DATA_URL = /^data:image\/(png|jpeg);base64,[a-z0-9+/=\s]+$/i;

const FORBID_TAGS = ['script', 'foreignObject', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'animate', 'animateMotion', 'animateTransform', 'set', 'use', 'image', 'feImage', 'a'];
const FORBID_ATTR = ['xlink:href', 'href', 'srcset', 'action', 'formaction', 'background', 'ping'];

let hooked = false;
function purifier(): typeof DOMPurify {
  if (!hooked && DOMPurify.isSupported) {
    // No links at all (href is forbidden); an image only as a raster data URL; inline styles that could load
    // something (url() other than a #pattern, image-set, @import) or run legacy CSS expressions are dropped.
    DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
      if (data.attrName === 'style' && /url\s*\((?!\s*#)|image-set|@import|expression\s*\(|behavior\s*:|-moz-binding/i.test(data.attrValue)) data.keepAttr = false;
      if (/^(fill|stroke|filter|mask|clip-path|marker-(start|mid|end))$/.test(data.attrName) && /url\s*\((?!\s*#)/i.test(data.attrValue)) data.keepAttr = false;
      if (data.attrName === 'src' && !RASTER_DATA_URL.test(data.attrValue)) data.keepAttr = false;
    });
    hooked = true;
  }
  return DOMPurify;
}

/** Generated SVG (a whole <svg> or SVG fragments), sanitized. */
export function sanitizeSvg(markup: string): string {
  const p = purifier();
  if (!p.isSupported) return '';
  return p.sanitize(markup, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS, FORBID_ATTR, ADD_ATTR: ['data-pit', 'data-bond', 'data-mid'] }) as string;
}

/** An SVG fragment for inside an <svg> element (markups): wrapped so it parses as SVG, unwrapped after. */
export function sanitizeSvgFragment(markup: string): string {
  const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`);
  return out.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

/** Generated HTML (the title block), sanitized: tables, text and raster logo images only. */
export function sanitizeHtml(markup: string): string {
  const p = purifier();
  if (!p.isSupported) return '';
  return p.sanitize(markup, { USE_PROFILES: { html: true }, FORBID_TAGS: FORBID_TAGS.filter((t) => t !== 'image'), FORBID_ATTR: FORBID_ATTR.filter((a) => a !== 'href') }) as string;
}

/** Sanitized SVG as a fragment of live nodes (for a shadow root), never via innerHTML. */
export function sanitizedSvgFragment(markup: string): DocumentFragment {
  const p = purifier();
  if (!p.isSupported) return document.createDocumentFragment();
  return p.sanitize(markup, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS, FORBID_ATTR, ADD_ATTR: ['data-pit', 'data-bond'], RETURN_DOM_FRAGMENT: true });
}
