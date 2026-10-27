import { describe, expect, it } from 'vitest';
import { normaliseRules, resolveRule, ruleIssues, type DesignRule } from './designRules';

const r = (id: string, value: number, when: DesignRule['when'] = {}, kind: DesignRule['kind'] = 'minWireMm2'): DesignRule => ({ id, kind, value, when });
const power = { category: 'power' as const, kw: 3 };

describe('resolveRule', () => {
  it('returns nothing without a matching row', () => {
    expect(resolveRule(undefined, 'minWireMm2', power)).toBeUndefined();
    expect(resolveRule([r('a', 2.5, { category: 'lighting' })], 'minWireMm2', power)).toBeUndefined();
    expect(resolveRule([r('a', 30, {}, 'elcbMa')], 'minWireMm2', power)).toBeUndefined();
  });
  it('the most specific row wins; a later row wins a tie', () => {
    const rules = [r('all', 2.5), r('pwr', 4, { category: 'power' }), r('hvac', 6, { category: 'power', loadType: 'hvac' }), r('pwr2', 10, { category: 'power' })];
    expect(resolveRule(rules, 'minWireMm2', power)?.id).toBe('pwr2');
    expect(resolveRule(rules, 'minWireMm2', { ...power, loadType: 'hvac' })?.id).toBe('hvac');
    expect(resolveRule(rules, 'minWireMm2', { category: 'lighting', kw: 0.5 })?.id).toBe('all');
  });
  it('a load threshold applies from that load upward; no load type counts as general', () => {
    const rules = [r('big', 6, { minKw: 5 }), r('gen', 4, { loadType: 'general' })];
    expect(resolveRule(rules, 'minWireMm2', { ...power, kw: 5 })?.id).toBe('gen'); // tie, later row
    expect(resolveRule([rules[0]], 'minWireMm2', { ...power, kw: 4.99 })).toBeUndefined();
    expect(resolveRule([rules[1]], 'minWireMm2', power)?.id).toBe('gen');
  });
});

describe('rule checks and file reading', () => {
  it('flags values out of range, negative thresholds and duplicate conditions', () => {
    expect(ruleIssues([r('a', 4, { category: 'power' })])).toEqual([]);
    expect(ruleIssues([r('a', 0.5)])[0]).toMatch(/outside 1–300 mm²/);
    expect(ruleIssues([r('a', 4, { minKw: -1 })])[0]).toMatch(/0 kW or more/);
    expect(ruleIssues([r('a', 4, { category: 'power' }), r('b', 6, { category: 'power' })])[0]).toMatch(/same circuits/);
  });
  it('drops unknown kinds and non-numbers, and keeps only known conditions', () => {
    const rows = normaliseRules([{ kind: 'minWireMm2', value: '4', when: { category: 'power', minKw: '2', colour: 'red' } }, { kind: 'paint', value: 1 }, { kind: 'elcbMa', value: 'x' }, null]);
    expect(rows).toEqual([{ id: 'rule-0', kind: 'minWireMm2', value: 4, when: { category: 'power', minKw: 2 } }]);
    expect(normaliseRules('nope')).toEqual([]);
  });
});
