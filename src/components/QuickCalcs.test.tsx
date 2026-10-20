import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleProject } from '../data/sampleProject';
import QuickCalcs from './QuickCalcs';

type SavedInputs = Record<string, Record<string, string>>;

const POWER_CARDS = ['amps', 'power', 'triangle'];
/** Renders with the first saved calculator open (or `card`, if given); the
 * three power calculators share the Power & current tab. */
function render(saved: SavedInputs = {}, card = Object.keys(saved)[0]) {
  const items = new Map(Object.entries(saved).map(([key, values]) => [`lvds.quick.${key}`, JSON.stringify(values)]));
  if (card) items.set('lvds.quick.tab', POWER_CARDS.includes(card) ? 'power' : card);
  if (POWER_CARDS.includes(card)) items.set('lvds.quick.powerMode', JSON.stringify({ m: card }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: vi.fn(),
    removeItem: vi.fn()
  });
  return renderToStaticMarkup(<QuickCalcs project={sampleProject} />);
}

const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;');
function card(html: string, title: string) {
  const section = html.split(/<section class="qc-card[^"]*"[^>]*>/).find((part) => part.includes(`<h4>${escaped(title)}</h4>`));
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
  const CARDS = ['amps', 'power', 'triangle', 'cable', 'vd', 'tx', 'motor', 'pfc', 'fault', 'lux', 'ohm', 'energy', 'units'];

  it('shows 11 tabs (the power calculators share one) and only the open calculator', () => {
    const html = render();
    expect(html.match(/role="tab"/g)).toHaveLength(11);
    expect(html.match(/<section class="qc-card/g)).toHaveLength(1);
    expect(html).toContain('<h4>Current from power</h4>');
  });

  it.each(CARDS)('renders the %s calculator with valid defaults', (key) => {
    const html = render({}, key);
    expect(html.match(/<section class="qc-card/g)).toHaveLength(1);
    expect(html).toContain(`data-card="${key}"`);
    expect(html).not.toContain('qc-field-error');
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain('Correct the highlighted inputs');
  });

  it.each(POWER_CARDS)('the %s calculator shows the power triangle, worked steps and supply values', (key) => {
    const html = render({}, key);
    expect(html).toContain('class="qc-triangle"');
    expect(html).toContain('Worked steps');
    expect(html).toContain('Size the cable for');
  });

  it('kW and PF: worked steps carry the numbers', () => {
    const html = render({ triangle: { known: 'kw-pf', x: '80', y: '0.8' } });
    expect(html).toContain('kVA = kW ÷ PF = 80 ÷ 0.8 = 100');
    expect(html).toContain('φ = acos PF = 36.9°');
  });

  it('cable: lists the sizes checked with the selected one marked', () => {
    const section = card(render({ cable: { i: '160', l: '50', amb: '45', g: '1', vd: '4' } }), 'Cable & breaker size');
    expect(section).toContain('Sizes checked');
    expect(section.match(/class="chosen"/g)).toHaveLength(1);
    expect(section).toContain('Worked steps');
  });

  it.each([
    ['vd', 'Voltage drop along the cable'],
    ['tx', 'Standard ratings at'],
    ['motor', 'Starting by starter'],
    ['pfc', 'Before and after correction'],
    ['fault', 'Fault level along the cable'],
    ['energy', 'Per year (365 days)'],
    ['units', 'AWG to mm²']
  ])('the %s calculator shows its right-hand panel', (key, text) => {
    const html = render({}, key);
    expect(html).toContain('class="qc-aside"');
    expect(html).toContain(text);
  });

  it('voltage drop: mV/A/m with parallel runs is divided by the runs once, matching the volts', () => {
    const one = card(render({ vd: { i: '100', l: '100', csa: '35', runs: '1', pf: '0.85' } }), 'Voltage drop');
    const two = card(render({ vd: { i: '100', l: '100', csa: '35', runs: '2', pf: '0.85' } }), 'Voltage drop');
    const value = (html: string, label: string) => Number(html.split(`<span>${label}</span><b>`)[1].split('<')[0]);
    expect(value(two, 'mV/A/m (2 runs)')).toBeCloseTo(value(one, 'mV/A/m') / 2, 2);
    // ΔV = mV/A/m × I × L ÷ 1000
    expect(value(two, 'Volts')).toBeCloseTo((value(two, 'mV/A/m (2 runs)') * 100 * 100) / 1000, 1);
  });

  it('motor: voltage dip at the source per starter, flagged against the limit', () => {
    const tx = card(render({ motor: { p: '11', src: 'tx', skva: '1000', sz: '5', dl: '15' } }), 'Motor');
    expect(tx).toContain('Voltage dip at source');
    expect(tx).toContain('Within the 15 % dip limit');
    const gen = card(render({ motor: { p: '160', st: 'DOL', src: 'gen', skva: '250', sz: '15', dl: '15' } }), 'Motor');
    expect(gen).toContain('Over the 15 % dip limit');
    expect(gen).toContain('250 kVA generator, X″d 15 %');
  });

  it('hides the right-hand panel while an input is invalid', () => {
    expect(render({ vd: { pf: '-0.8' } })).not.toContain('class="qc-aside"');
  });

  it('draws the lux layout plan with the grid and setting-out dimensions', () => {
    const section = card(render({ lux: { l: '10', w: '8' } }), 'Lighting — lux (lumen method)');
    expect(section).toContain('class="lux-plan"');
    expect(section.match(/class="lum"/g)).toHaveLength(20); // 4 × 5
    expect(section).toContain('L = 10.00 m');
    expect(section).toContain('W = 8.00 m');
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

describe('Quick calculator saved inputs and accessibility', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('drops a saved voltage whose project default has changed, keeping the other saved inputs', () => {
    const section = card(render({ amps: { v: { v: '440', p: '55' }, base: { v: '400', p: '100' } } as never }), 'Current from power');
    expect(field(section, 'Voltage (L-L)')).toContain('value="415"');
    expect(field(section, 'Power')).toContain('value="55"');
    expect(section).toContain('Saved inputs');
  });

  it('keeps a saved voltage typed against the same project default', () => {
    const section = card(render({ amps: { v: { v: '440' }, base: { v: '415' } } as never }), 'Current from power');
    expect(field(section, 'Voltage (L-L)')).toContain('value="440"');
  });

  it('shows no saved-inputs badge on defaults, and a worded reset button', () => {
    const section = card(render({ amps: {} }), 'Current from power');
    expect(section).not.toContain('Saved inputs');
    expect(section).toContain('Reset inputs');
  });

  it('gives only the open tab a tab stop and announces results', () => {
    const html = render({ vd: {} });
    expect(html.match(/role="tab"[^>]*tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/id="qc-tab-vd"[^>]*tabindex="0"/);
    expect(html).toContain('class="qc-result" aria-live="polite"');
  });

  it('labels the breaker as a reference rating, with its assumptions beside it', () => {
    const section = card(render({ amps: {} }), 'Current from power');
    expect(section).toContain('Reference rating ≥ current');
    expect(section).toContain('for reference only');
  });
});
