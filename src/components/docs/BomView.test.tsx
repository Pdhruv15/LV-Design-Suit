import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleProject } from '../../data/sampleProject';
import type { BoqCustom } from '../../model/priceList';
import BomView from './BomView';

const render = (boq?: BoqCustom) => renderToStaticMarkup(<BomView project={{ ...sampleProject, boq }} results={[]} onChange={vi.fn()} onStatus={vi.fn()} />);
const row = (html: string, description: string) => html.split('<tr').find((part) => part.includes(description))!.split('</tr>')[0];

beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

describe('BOQ rendered scope and pricing', () => {
  it('keeps the BOQ table and navigation, with scope review inside the existing page', () => {
    const html = render();
    for (const label of ['Bill of quantities', 'Scope &amp; review', 'Changes since a revision', 'Per circuit', 'Supply rate', 'Install rate', 'Location / note']) expect(html).toContain(label);
    expect(html).not.toContain('modal-backdrop');
    expect(html).toContain('Load schedule ELCB groups');
  });

  it('shows contractor installation only for client-supplied equipment', () => {
    const html = render({ manual: [{ id: 'client', section: 'O', description: 'Client equipment connection', unit: 'no', qty: 2, rate: 900, labour: 20, supplyBy: 'client', evidence: 'Drawing E-10' }] });
    const markup = row(html, 'Client equipment connection');
    expect(markup).toContain('Supply: client');
    expect(markup).not.toContain('aria-label="Supply rate:');
    expect(markup).toContain('aria-label="Install rate:');
    expect(markup).toContain('40.00');
    expect(markup).toContain('Drawing E-10');
    expect(markup).not.toContain('rate required');
  });

  it('keeps retained assets visible without editable new supply or installation rates', () => {
    const html = render({ manual: [{ id: 'retained', section: 'N', description: 'Existing socket retained', unit: 'no', qty: 3, rate: 90, labour: 10, action: 'retain' }] });
    const markup = row(html, 'Existing socket retained');
    expect(markup).toContain('Retained');
    expect(markup).not.toContain('aria-label="Supply rate:');
    expect(markup).not.toContain('aria-label="Install rate:');
    expect(markup).not.toContain('rate required');
  });

  it('distinguishes missing installation rates from explicit zero quotes', () => {
    const html = render({ manual: [
      { id: 'missing', section: 'O', description: 'Unquoted installation', unit: 'no', qty: 1, supplyBy: 'client' },
      { id: 'zero', section: 'O', description: 'Quoted zero installation', unit: 'no', qty: 1, labour: 0, supplyBy: 'client' }
    ] });
    expect(row(html, 'Unquoted installation')).toContain('rate required');
    expect(row(html, 'Quoted zero installation')).not.toContain('rate required');
    expect(row(html, 'Quoted zero installation')).toContain('0.00');
  });

  it('includes schedule point quantities only when explicitly selected', () => {
    expect(render()).not.toContain('load schedule point count;');
    const html = render({ includeSchedulePoints: true });
    expect(html).toContain('Load schedule point counts');
    expect(row(html, 'Water pump — load schedule point count')).toContain('Supply: client');
    expect(row(html, '13 A socket-outlet — load schedule point count')).toContain('Supply: contractor');
  });
});
