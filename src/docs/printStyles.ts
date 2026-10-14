/** Shared print tokens: the one black-and-white look of every PDF report.
 * Black text and rules on white, a light grey table-header fill, Arial.
 * Status is told by its word and weight, never by colour — the reports
 * must read the same on a mono printer. Drawings (SLD, sheets) keep their
 * own title-block styles. */

export const PRINT = {
  font: 'Arial, Helvetica, sans-serif',
  ink: '#000',
  /** Secondary text: labels, notes, captions, the running header / footer. */
  ink2: '#444',
  rule: '#000',
  /** Hairlines between key / value rows and contents entries. */
  ruleLight: '#999',
  /** Table-header and total-row fill. */
  fill: '#f2f2f2',
  body: '9pt',
  table: '8pt',
  small: '7.5pt',
  h1: '22pt',
  h2: '11pt',
  h3: '9.5pt',
  thin: '0.4pt',
  heavy: '1.2pt'
} as const;

const P = PRINT;

/** Status cells and words (ok / warn / bad / nc / data, as in calc/statusText):
 * PASS plain, WARNING bold, FAIL bold and boxed, NOT CHECKED / DATA REQUIRED grey italic. */
export const STATUS_CSS = `
.warn, .bad { font-weight: 700; }
.nc, .data { font-style: italic; color: ${P.ink2}; }
.st { white-space: nowrap; }
.bad > .st { border: 0.8pt solid ${P.rule}; padding: 0 1.4mm; }`;

/** Wraps a status word for a table cell, so a FAIL is boxed round the word, not the whole cell. */
export const statusSpan = (html: string) => `<span class="st">${html}</span>`;

/** Outlined call-out (no fill) and the "Not defined" marker. */
export const NOTE_CSS = `
.warning, .callout { border: ${P.thin} solid ${P.rule}; border-left: 2.4pt solid ${P.rule}; background: none; color: ${P.ink}; padding: 2mm 3mm; margin: 3mm 0; break-inside: avoid; }
.missing { color: ${P.ink}; font-style: italic; text-decoration: underline dashed 0.6pt; text-underline-offset: 2px; }`;

/** Typography and tables of the A4 reports (study, review, calculation summaries). */
export const PRINT_BASE_CSS = `
html, body { background: #fff; color-scheme: light; }
body { font: ${P.body}/1.4 ${P.font}; color: ${P.ink}; margin: 0; }
h1 { font-size: 16pt; margin: 0 0 2px; }
h2 { font-size: ${P.h2}; text-transform: uppercase; letter-spacing: .03em; margin: 18px 0 6px; padding-bottom: 1.2mm; border-bottom: ${P.heavy} solid ${P.rule}; color: ${P.ink}; break-after: avoid; }
h3 { font-size: ${P.h3}; color: ${P.ink}; break-after: avoid; }
.sub { color: ${P.ink2}; margin: 0 0 12px; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin: 8px 0; }
.kpi { border: ${P.thin} solid ${P.rule}; padding: 1.6mm 2.4mm; } .kpi b { display: block; font-size: 11pt; } .kpi span { color: ${P.ink2}; font-size: ${P.small}; }
table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; font-size: ${P.table}; }
th, td { border: ${P.thin} solid ${P.rule}; padding: 1.1mm 1.6mm; text-align: left; vertical-align: top; }
th { background: ${P.fill}; font-weight: 700; } thead { display: table-header-group; } tr { break-inside: avoid; }
tr.total td { background: ${P.fill}; font-weight: 700; }
ul { margin: 4px 0; padding-left: 18px; } .note { color: ${P.ink2}; }
${STATUS_CSS}
${NOTE_CSS}`;
