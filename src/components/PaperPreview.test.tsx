import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaperPreview, pageOf } from './PaperPreview';
import { REPORT_CSS } from '../docs/report';

describe('pageOf', () => {
  it('reads paper and margins from the report’s own @page rule; the last unnamed rule wins, named pages are ignored', () => {
    const html = `<style>${REPORT_CSS} @page { size: A4 landscape; margin: 16mm 14mm 14mm; } @page sld { size: A3 landscape; margin: 10mm; }</style>`;
    expect(pageOf(html)).toEqual({ size: 'A4', landscape: true, wMm: 297, hMm: 210, margin: [16, 14, 14, 14] });
  });
  it('matches the shared report CSS (A4 landscape, 14 / 12 mm)', () => {
    expect(pageOf(`<style>${REPORT_CSS}</style>`)).toMatchObject({ size: 'A4', landscape: true, margin: [14, 12, 14, 12] });
  });
  it('falls back to A4 portrait, 12 mm', () => {
    expect(pageOf('<p>no page rule</p>')).toEqual({ size: 'A4', landscape: false, wMm: 210, hMm: 297, margin: [12, 12, 12, 12] });
  });
});

describe('PaperPreview', () => {
  it('labels the paper and pads only the preview copy with the page margins', () => {
    const html = '<html><head><style>@page { size: A4 landscape; margin: 14mm 12mm; }</style></head><body>x</body></html>';
    const out = renderToStaticMarkup(<PaperPreview title="Report preview" html={html} />);
    expect(out).toContain('A4 landscape · margins 14 / 12 / 14 / 12 mm');
    expect(out).toContain('padding:14mm 12mm 14mm 12mm');
    expect(html).not.toContain('padding'); // the export's HTML is untouched
  });
});
