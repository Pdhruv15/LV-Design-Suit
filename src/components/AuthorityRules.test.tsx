import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NewProjectWizard } from './BriefEditor';
import { RuleRows, appliesText } from './docs/RuleRows';
import DesignReferencesView from './docs/DesignReferencesView';
import { BUILT_IN_REFERENCES } from '../model/designReference';
import { sampleProject } from '../data/sampleProject';
import type { DesignRule } from '../model/designRules';

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('new project: authority and design rules', () => {
  it('offers country, authority and rule set, starting on DEWA, with the values the project starts with', () => {
    const html = renderToStaticMarkup(<NewProjectWizard initialName="Villa" references={BUILT_IN_REFERENCES} onQuick={noop} onCreate={noop} onCancel={noop} />);
    const t = text(html);
    expect(t).toContain('Authority and design rules');
    expect(html).toMatch(/<option value="United Arab Emirates" selected="">United Arab Emirates<\/option>/);
    expect(t).toMatch(/DEWA — Dubai.*ADDC — Abu Dhabi.*EtihadWE — Northern Emirates/);
    expect(t).toContain('DEWA (Dubai) — built-in v1');
    expect(t).toMatch(/415 V · 50 Hz.*Ambient 45 °C.*VD 4 %.*Min wire 2.5 \/ 4 mm².*ELCB 100 \/ 30 mA.*To verify/);
    expect(t).toContain('filled in as DEWA');
  });
});

describe('rule rows', () => {
  const rule = (p: Partial<DesignRule>): DesignRule => ({ id: 'r', kind: 'elcbMa', when: {}, value: 30, ...p });
  it('describes what a row applies to', () => {
    expect(appliesText(rule({}))).toBe('All circuits');
    expect(appliesText(rule({ when: { category: 'power', loadType: 'hvac', minKw: 5 } }))).toBe('Power · HVAC · from 5 kW');
  });
  it('shows rows from a reference read only with their source, and the project\'s own as fields', () => {
    const html = renderToStaticMarkup(<RuleRows rows={[rule({ id: 'mine', kind: 'minWireMm2', value: 6, when: { loadType: 'hvac' } })]} fixed={[rule({ id: 'ref', when: { loadType: 'sockets' }, from: 'ADDC (Abu Dhabi) v2', clause: '5.4.8' })]} onChange={noop} empty="none" />);
    const t = text(html);
    expect(t).toContain('Small power / sockets');
    expect(t).toContain('30 mA');
    expect(t).toContain('ADDC (Abu Dhabi) v2');
    expect(html).toMatch(/aria-label="Value"[^>]*value="6"/);
    expect(t).toContain('Here');
    expect(renderToStaticMarkup(<RuleRows rows={[]} empty="No rule rows yet" />)).toContain('No rule rows yet');
  });
});

describe('design references', () => {
  it('has the builds-on choice and the rule rows section', () => {
    const t = text(renderToStaticMarkup(<DesignReferencesView project={sampleProject} onApply={noop} onStatus={noop} />));
    expect(t).toContain('Builds on');
    expect(t).toContain('Nothing (stand-alone)');
    expect(t).toContain('Rule rows');
  });
});
