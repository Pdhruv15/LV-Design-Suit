// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { printableSvg } from './exportSvg';

describe('printed SLD colours', () => {
  vi.stubGlobal('SVGTextElement', class {}); // not in jsdom

  it('prints revision clouds and cable references black, other colours as mapped', () => {
    document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
      <g class="rev-cloud"><path d="M0 0 H10" style="stroke: rgb(255, 93, 108)"/></g>
      <circle class="cable-ref-c" r="7" style="stroke: rgb(255, 93, 108)"/>
      <line class="other" x2="10" style="stroke: rgb(1, 2, 3)"/></svg>`;
    const out = printableSvg(document.querySelector('svg')!, 100, 50);
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    expect(doc.querySelector('.rev-cloud path')?.getAttribute('style')).toContain('stroke:#000000');
    expect(doc.querySelector('.cable-ref-c')?.getAttribute('style')).toContain('stroke:#000000');
    expect(doc.querySelector('.other')?.getAttribute('style')).toContain('stroke:rgb(1, 2, 3)');
  });
});
