/** Bookmarks (the PDF outline) from markers in the HTML. A section heading carries
 * <a class="dest" href="#id" data-bm="Title"></a>: the self-link makes Chrome record the page the
 * section lands on (a named destination), and the export turns each marker into a bookmark on that
 * page. No pdf-lib here, so the report builders can use it without loading the PDF tools. */

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The marker for a section: put it inside (or just before) the section's heading. */
export const destMarker = (id: string, title: string) => `<a class="dest" href="#${escAttr(id)}" data-bm="${escAttr(title)}"></a>`;

/** Every marker in a document, in document order. */
export function bookmarkMarkers(html: string): { id: string; title: string }[] {
  return [...html.matchAll(/<a class="dest" href="#([^"]+)" data-bm="([^"]*)"><\/a>/g)].map((m) => ({ id: unescAttr(m[1]), title: unescAttr(m[2]) }));
}

/** The bookmarks of a printed document: each marker on the page its section landed on (pages are 1-based,
 * as destinationPages gives them; bookmarks 0-based). Markers whose page is unknown are left out. */
export function markerBookmarks(html: string, pages: Record<string, number>): { title: string; page: number }[] {
  return bookmarkMarkers(html).filter((m) => pages[m.id] > 0 && m.title.trim()).map((m) => ({ title: m.title, page: pages[m.id] - 1 }));
}
