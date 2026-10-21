import { describe, expect, it } from 'vitest';
import { checkNumber, ruleText } from './ui';

describe('checkNumber', () => {
  it('reads numbers as engineers type them', () => {
    expect(checkNumber('1,250').value).toBe(1250);
    expect(checkNumber('12,50,000').value).toBe(1250000);
    expect(checkNumber('0,8').value).toBe(0.8);
    expect(checkNumber(' 2.5 ').value).toBe(2.5);
    expect(checkNumber('−5').value).toBe(-5);
  });
  it('explains what is wrong in words, without clamping', () => {
    expect(checkNumber('abc')).toEqual({ error: 'Enter a number' });
    expect(checkNumber('', { min: 0, unit: 'm²' })).toEqual({ error: 'Enter 0 or more m²' });
    expect(checkNumber('120', { min: 0, max: 100, unit: '%' })).toEqual({ error: 'Enter 0 to 100 %' });
    expect(checkNumber('0', { min: 0, minExclusive: true, unit: '%' })).toEqual({ error: 'Enter more than 0 %' });
    expect(checkNumber('100', { min: 0, max: 100 }).value).toBe(100);
  });
  it('words the rule', () => {
    expect(ruleText({ min: -20, max: 250, minExclusive: true, maxExclusive: true, unit: '°C' })).toBe('more than −20 and less than 250 °C');
    expect(ruleText({ max: 5 })).toBe('5 or less');
  });
});
