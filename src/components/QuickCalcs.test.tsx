import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleProject } from '../data/sampleProject';
import QuickCalcs from './QuickCalcs';

type SavedInputs = Record<string, Record<string, string>>;

function render(saved: SavedInputs = {}) {
  const items = new Map(Object.entries(saved).map(([card, values]) => [`lvds.quick.${card}`, JSON.stringify(values)]));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: vi.fn(),
    removeItem: vi.fn()
  });
  return renderToStaticMarkup(<QuickCalcs project={sampleProject} />);
}

const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;');
function card(html: string, title: string) {
  const section = html.split('<section class="qc-card">').find((part) => part.includes(`<h4>${escaped(title)}</h4>`));
  expect(section, `Missing calculator card: ${title}`).toBeDefined();
  return section!.split('</section>')[0];
}

function field(section: string, label: string) {
  const markup = section.split('<label class="qc-field">').find((part) => part.startsWith(`<span>${escaped(label)}</span>`));
  expect(markup, `Missing field: ${label}`).toBeDefined();
  return markup!.split('</label>')[0];
}

function expectSuppressed(section: string) {
  expect(section).toContain('Correct the highlighted inputs to calculate.');
  expect(section).not.toContain('class="qc-out');
  expect(section).not.toContain('class="qc-ok"');
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('Quick calculator rendered input and result behavior', () => {
  it('renders all 12 calculators with valid defaults', () => {
    const html = render();
    expect(html.match(/<section class="qc-card">/g)).toHaveLength(12);
    expect(html).not.toContain('qc-field-error');
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain('Correct the highlighted inputs');
  });

  it('shows a missing-breaker warning instead of a 0 A breaker or successful cable selection', () => {
    const section = card(render({ cable: { i: '4500', l: '10', amb: '30' } }), 'Cable & breaker size');
    expect(section).toContain('No available breaker rating meets this current.');
    expect(section).not.toContain('class="qc-out');
    expect(section).not.toContain('<b>0<small> A</small></b>');
    expect(section).not.toContain('qc-field-error');
  });

  it('requires a cleared power factor instead of calculating with a default', () => {
    const section = card(render({ amps: { pf: '' } }), 'Current from power');
    const input = field(section, 'Power factor');
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby=');
    expect(input).toContain('Enter power factor.');
    expectSuppressed(section);
  });

  it.each(['', '0'])('requires a positive grouping factor when saved value is %j', (g) => {
    const section = card(render({ cable: { g } }), 'Cable & breaker size');
    expect(field(section, 'Grouping factor')).toContain('aria-invalid="true"');
    expect(field(section, 'Grouping factor')).toContain(g === '' ? 'Enter grouping factor.' : 'Grouping factor must be above 0.');
    expectSuppressed(section);
  });

  it('rejects negative voltage-drop PF and never displays a within-limit result', () => {
    const section = card(render({ vd: { pf: '-0.8' } }), 'Voltage drop');
    expect(field(section, 'Power factor')).toContain('aria-invalid="true"');
    expect(field(section, 'Power factor')).toContain('Power factor must be at least 0.');
    expect(section).not.toContain('Within the');
    expectSuppressed(section);
  });

  it('does not display a within-limit status when finite inputs overflow the calculation', () => {
    const section = card(render({ vd: { i: '1.7e308', l: '0' } }), 'Voltage drop');
    expect(section).toContain('qc-warn');
    expect(section).not.toContain('Within the');
    expect(section).not.toContain('class="qc-ok"');
    expect(section).not.toContain('class="qc-out');
  });

  it.each([
    ['vd', 'Voltage drop'],
    ['fault', 'Fault level at end of cable']
  ])('rejects fractional parallel runs in %s', (key, title) => {
    const section = card(render({ [key]: { runs: '1.5' } }), title);
    expect(field(section, 'Runs in parallel')).toContain('Runs in parallel must be a whole number.');
    expectSuppressed(section);
  });

  it('rejects more than 24 operating hours per day', () => {
    const section = card(render({ energy: { h: '25' } }), 'Energy & cost');
    expect(field(section, 'Hours per day')).toContain('Hours per day must be at most 24.');
    expectSuppressed(section);
  });

  it.each([
    ['tx', 'Transformer', 'Impedance Z'],
    ['fault', 'Fault level at end of cable', 'Impedance']
  ])('rejects zero transformer impedance in %s', (key, title, label) => {
    const section = card(render({ [key]: { z: '0' } }), title);
    expect(field(section, label)).toContain('Impedance must be above 0.');
    expectSuppressed(section);
  });

  it('ignores unused saved PF and efficiency when calculating from kVA', () => {
    const section = card(render({ amps: { unit: 'kVA', p: '100', pf: '-2', eff: '' } }), 'Current from power');
    expect(section).not.toContain('qc-field-error');
    expect(section).not.toContain('<span>Power factor</span>');
    expect(section).not.toContain('<span>Efficiency η</span>');
    expect(section).toContain('<b>139.1<small> A</small></b>');
  });

  it('shows the efficiency used for a W calculation', () => {
    const section = card(render({ amps: { unit: 'W', p: '10000', eff: '0.9' } }), 'Current from power');
    expect(field(section, 'Efficiency η')).toContain('value="0.9"');
    expect(section).toContain('<b>18.2<small> A</small></b>');
  });

  it('shows an efficiency error in W mode instead of hiding an input that blocks calculation', () => {
    const section = card(render({ amps: { unit: 'W', eff: '1.2' } }), 'Current from power');
    expect(field(section, 'Efficiency η')).toContain('Efficiency must be at most 1.');
    expectSuppressed(section);
  });
});
