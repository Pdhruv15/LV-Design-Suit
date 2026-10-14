import type { Project } from '../types';
import { PRINT, STATUS_CSS } from './printStyles';

const escH = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** A quoted CSS string for `content:` inside the <style> element. */
export const cssStr = (v: string) => `"${v.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ').replace(/</g, '\\3c ')}"`;
/** Only plain base64 images go into the stylesheet (running-header logo). */
export const cssImage = (v?: string) => (v && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : undefined);

/** A plain A4 print document in the BOQ style: running header with the company logo (or
 * company name) and project · `headRight`, footer with `footer` and Page n of N, and the
 * shared typography and table styles. Used by the BOQ, the variation and submission registers and the calculation report. */
export function printDoc(project: Project, o: { title: string; headRight: string; footer: string; body: string; landscape?: boolean }): string {
  const company = project.drawing?.company?.trim() || project.info?.consultant?.trim() || '';
  const headLogo = cssImage(project.drawing?.logo);
  const { footer, body } = o;
  const box = (where: string, content: string, extra = '') => `@${where} { content: ${content}; ${extra} }`;
  const rule = `font: 7.5pt ${PRINT.font}; color: ${PRINT.ink2};`;
  const top = `${rule} vertical-align: bottom; padding-bottom: 2.5mm; border-bottom: 0.4pt solid ${PRINT.rule};`;
  const bottom = `${rule} vertical-align: top; padding-top: 2.5mm; border-top: 0.4pt solid ${PRINT.rule};`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escH(o.title)}</title><style>
@page { size: A4${o.landscape ? ' landscape' : ''}; margin: 21mm 14mm 16mm 16mm;
  ${headLogo ? box('top-left', '""', `width: 45mm; background: url("${headLogo}") no-repeat left bottom 2.5mm / auto 9mm; ${top}`) : box('top-left', cssStr(company || project.name), top)}
  ${box('top-right', cssStr(`${headLogo || company ? `${project.name}   ·   ` : ''}${o.headRight}`), top)}
  ${box('bottom-left', cssStr(footer), bottom)}
  ${box('bottom-right', '"Page " counter(page) " of " counter(pages)', bottom)}
}
@page cover { margin: 16mm; @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }
* { box-sizing: border-box; }
body { font: 8.5pt/1.35 ${PRINT.font}; color: ${PRINT.ink}; margin: 0; }
a { color: inherit; text-decoration: none; } a.dest { display: block; height: 0; }
h1 { margin: 0; } h2 { font-size: 11pt; margin: 0 0 3mm; text-transform: uppercase; letter-spacing: .02em; } h3 { font-size: 9pt; margin: 5mm 0 2mm; text-transform: uppercase; }
p { margin: 1.5mm 0; } .small { font-size: 7.6pt; color: ${PRINT.ink2}; } .pre { white-space: pre-wrap; overflow-wrap: anywhere; } ul { margin: 1mm 0 1mm 5mm; padding: 0; }
.page { break-before: page; }
.k { font-size: 8.5pt; letter-spacing: .2em; color: ${PRINT.ink2}; text-transform: uppercase; }
.cover { page: cover; height: 264mm; display: flex; flex-direction: column; }
.cover .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1.2pt solid ${PRINT.rule}; padding-bottom: 4mm; min-height: 18mm; }
.cover .logo { max-height: 18mm; max-width: 60mm; } .cover .co { font-size: 10pt; font-weight: 700; text-align: right; }
.cover .mid { flex: 1; display: flex; flex-direction: column; justify-content: center; }
.cover h1 { font-size: 24pt; margin: 2mm 0 1mm; letter-spacing: .02em; } .cover .pn { font-size: 14pt; margin-bottom: 8mm; }
.kv { border-collapse: collapse; width: 100%; font-size: 9pt; } .kv td { padding: 1.6mm 2mm; border-bottom: 0.3pt solid #bbb; } .kv td:first-child { width: 40mm; color: ${PRINT.ink2}; }
.grid { border-collapse: collapse; width: 100%; font-size: 8pt; margin-top: 5mm; } .grid th, .grid td { border: 0.4pt solid ${PRINT.rule}; padding: 1.4mm 2mm; text-align: left; vertical-align: top; }
.grid th { background: ${PRINT.fill}; } .grid td.sig { height: 10mm; } .sign { margin-top: 10mm; }
.sub { margin: -2mm 0 3mm; }
ol.notes { margin: 0; padding-left: 5mm; } ol.notes li { margin: 0 0 1.5mm; }
.legend td { padding: 0.6mm 3mm 0.6mm 0; vertical-align: top; }
.box { border: 0.4pt solid ${PRINT.rule}; padding: 2mm 3mm; margin: 4mm 0; break-inside: avoid; }
.contents { border-collapse: collapse; width: 100%; } .contents td { padding: 1mm 0; border-bottom: 0.3pt dotted #999; } .contents td.n { width: 15mm; }
table.b { width: 100%; border-collapse: collapse; }
table.b th, table.b td { border-left: 0.4pt solid ${PRINT.rule}; border-right: 0.4pt solid ${PRINT.rule}; padding: 1.1mm 1.5mm; vertical-align: top; text-align: left; }
table.b thead { display: table-header-group; } table.b thead th { border: 0.4pt solid ${PRINT.rule}; background: ${PRINT.fill}; font-size: 7.6pt; text-align: center; vertical-align: middle; }
table.b tr { break-inside: avoid; } table.b tbody tr + tr td { border-top: 0.2pt dotted #aaa; } table.b tbody:last-child tr:last-child td { border-bottom: 0.4pt solid ${PRINT.rule}; }
.c { text-align: center !important; } .n { text-align: right !important; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sec { break-after: avoid; } .sec td { font-weight: 700; border-top: 0.4pt solid ${PRINT.rule}; border-bottom: 0.4pt solid ${PRINT.rule}; padding-top: 1.8mm !important; padding-bottom: 1.8mm !important; }
.tot td { font-weight: 700; border-top: 0.4pt solid ${PRINT.rule} !important; border-bottom: 0.4pt solid ${PRINT.rule}; }
.gt td { font-weight: 700; font-size: 9.5pt; border-top: 1.5pt double #000 !important; border-bottom: 1pt solid ${PRINT.rule} !important; }
.sum td { padding: 1.8mm 2mm; }
.ref { font-size: 7.1pt; color: #555; margin-top: 0.5mm; } sup { font-size: 6.3pt; line-height: 0; } i { color: #333; }
.bill td:first-child { white-space: nowrap; } .chg td { background: #e8e8e8; } .tri { vertical-align: -2px; } s { color: #333; } .hist { margin-top: 0; }
.words { margin-top: 3mm; border: 0.4pt solid ${PRINT.rule}; padding: 2mm 3mm; }${STATUS_CSS}
</style></head><body>${body}</body></html>`;
}
