// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Project } from '../types';
import { earthingDrawing } from '../diagram/earthingDrawing';
import { markupSvg, markupHit, type SheetMarkup } from '../model/sheetMarkup';
import { titleBlockHtml, type TitleTemplate } from '../model/titleBlock';
import { sanitizeHtml, sanitizeSvg, sanitizeSvgFragment, sanitizedSvgFragment } from './sanitize';
import { escapeHtmlAttr, escapeHtmlText } from './escape';

/** Payloads aimed at each context: element, attribute, style sheet, URL. */
const PAYLOADS = [
  'X"><script>alert(1)</script>',
  "X' onload='alert(1)",
  'X"><g onload="alert(1)"/>',
  '</style><img src=x onerror=alert(1)>',
  '"]{}*{background:url(https://evil.example/x)}[x="',
  '<foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject>'
];

/** Everything that could make markup active or reach out: script elements, foreign content, event handlers, script or external URLs, style elements. */
function activeParts(markup: string, type: DOMParserSupportedType = 'text/html'): string[] {
  const doc = new DOMParser().parseFromString(type === 'text/html' ? `<div>${markup}</div>` : markup, type);
  const found: string[] = [];
  doc.querySelectorAll('*').forEach((el) => {
    const tag = el.localName.toLowerCase();
    if (['script', 'foreignobject', 'iframe', 'object', 'embed', 'style', 'link'].includes(tag)) found.push(`<${tag}>`);
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name)) found.push(`${tag}@${a.name}`);
      // Only attributes that load or navigate: links, sources, styles and paint servers.
      const loads = /^(href|xlink:href|src|srcset|action|formaction|style|fill|stroke|filter|mask|clip-path|marker-(start|mid|end))$/i.test(a.name);
      if (loads && /javascript:|https?:\/\/|url\s*\((?!\s*#)/i.test(a.value)) found.push(`${tag}@${a.name}=${a.value}`);
    }
  });
  return found;
}

/** The sample project with a payload as a main board's ID (as a crafted file could carry it). */
function withBoardId(id: string): Project {
  const p = JSON.parse(JSON.stringify(sampleProject)) as Project;
  const old = p.boards.find((b) => !b.upstreamId)!.id;
  const rename = (v?: string) => (v === old ? id : v);
  p.boards = p.boards.map((b) => ({ ...b, id: rename(b.id)!, upstreamId: rename(b.upstreamId) }));
  p.feeders = p.feeders.map((f) => ({ ...f, boardId: rename(f.boardId)!, feedsBoardId: rename(f.feedsBoardId) }));
  return p;
}

describe('escaping', () => {
  it('escapes text and quoted attributes for their context', () => {
    expect(escapeHtmlText('<a href="x">&</a>')).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
    expect(escapeHtmlAttr(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;');
  });
});

describe('earthing schematic with crafted IDs', () => {
  for (const payload of PAYLOADS) {
    it(`stays inert with board ID ${JSON.stringify(payload)}`, () => {
      const { svg } = earthingDrawing(withBoardId(payload));
      expect(activeParts(svg, 'image/svg+xml')).toEqual([]);
      expect(activeParts(sanitizeSvg(svg))).toEqual([]);
      // The ID is still shown, as plain text.
      const text = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.textContent ?? '';
      expect(text).toContain(payload);
    });
  }

  it('keeps a crafted pit ID inside its data-pit attribute', () => {
    // Bypasses file validation on purpose: the drawing must be safe on its own.
    const p = { ...sampleProject, earthPitIds: { 'lv:MDB-1': [PAYLOADS[0], PAYLOADS[2]] } } as Project;
    const { svg } = earthingDrawing(p);
    expect(activeParts(svg, 'image/svg+xml')).toEqual([]);
    const pits = Array.from(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('[data-pit]')).map((g) => g.getAttribute('data-pit'));
    expect(pits).toEqual(expect.arrayContaining([PAYLOADS[0], PAYLOADS[2]]));
  });

  it('draws a normal project the same after sanitizing (nothing dropped)', () => {
    const { svg } = earthingDrawing(sampleProject);
    const shape = (s: string) => {
      const out: string[] = [];
      new DOMParser().parseFromString(`<div>${s}</div>`, 'text/html').querySelectorAll('*').forEach((e) => out.push(`${e.localName}:${Array.from(e.attributes).map((a) => a.name).sort().join(',')}`));
      return out;
    };
    expect(shape(sanitizeSvg(svg))).toEqual(shape(svg));
    const frag = sanitizedSvgFragment(svg);
    expect(frag.querySelectorAll('[data-pit]').length).toBe(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('[data-pit]').length);
  });
});

describe('sanitizer', () => {
  it('removes scripts, handlers, foreign content, links and loading styles', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><style>*{background:url(https://x)}</style>
      <foreignObject><div>x</div></foreignObject><a href="javascript:alert(1)"><text>a</text></a><use href="https://x/y.svg#z"/>
      <image href="https://x/i.png"/><rect style="fill:url(https://x/p)" width="1"/><rect fill="url(https://x/p)" width="2"/>
      <animate attributeName="href" to="javascript:alert(1)"/><rect fill="url(#hatch)" width="3"/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(activeParts(clean)).toEqual([]);
    expect(clean).not.toMatch(/<(use|image|animate|a)\b/);
    expect(clean).toContain('fill="url(#hatch)"'); // patterns inside the drawing still work
  });

  it('keeps a raster logo and drops any other image source', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeHtml(`<img src="${png}">`)).toContain(png);
    expect(sanitizeHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).not.toContain('svg+xml');
    expect(sanitizeHtml('<img src="https://evil.example/x.png">')).not.toContain('evil');
  });
});

describe('markups and title block with crafted text', () => {
  it('renders markup text inert', () => {
    for (const payload of PAYLOADS) {
      for (const kind of ['text', 'callout', 'cloud'] as const) {
        const m: SheetMarkup = { id: payload, kind, x: 10, y: 10, x2: 40, y2: 30, w: 20, h: 10, text: payload, rev: payload };
        const svg = markupSvg(m) + markupHit(m);
        expect(activeParts(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`, 'image/svg+xml')).toEqual([]);
        expect(activeParts(sanitizeSvgFragment(svg))).toEqual([]);
      }
    }
  });

  it('renders title block text, sizes and alignment inert', () => {
    const t = {
      id: 't', name: 'T', cols: [20, '30mm"><script>alert(1)</script>'], rows: [10],
      cells: [
        { id: 'a', r: 0, c: 0, kind: 'text', text: PAYLOADS[0], caption: PAYLOADS[3], align: 'left;background:url(https://evil.example/)', rs: '1" onclick="alert(1)', size: '8pt;background:url(https://evil.example/)' },
        { id: 'b', r: 0, c: 1, kind: 'logo', text: '' }
      ]
    } as unknown as TitleTemplate;
    const p = { ...sampleProject, drawing: { logo: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+' } } as Project;
    const html = titleBlockHtml(t, p);
    expect(activeParts(html)).toEqual([]);
    expect(html).not.toContain('svg+xml');
    expect(html).not.toContain('evil.example');
    expect(activeParts(sanitizeHtml(html))).toEqual([]);
  });
});
