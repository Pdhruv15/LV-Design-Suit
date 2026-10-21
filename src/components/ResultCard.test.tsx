import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultCard } from './ui';

describe('ResultCard', () => {
  it('names the status in words next to the coloured value, never colour alone', () => {
    const html = renderToStaticMarkup(<ResultCard label="Worst voltage drop" value="4.80 %" status="bad" sub="FF-LTG" />);
    expect(html).toContain('dash-value bad');
    expect(html).toMatch(/class="result-status bad">FAIL</);
  });
  it('is a plain figure without a status, and a link only with onClick', () => {
    const plain = renderToStaticMarkup(<ResultCard label="Limit" value="4 %" />);
    expect(plain).not.toContain('result-status');
    expect(plain).toContain('disabled=""');
    expect(renderToStaticMarkup(<ResultCard label="Worst" value="1" onClick={() => {}} />)).toContain('result-card link');
  });
});
