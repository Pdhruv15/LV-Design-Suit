import { describe, expect, it } from 'vitest';
import { displayVersion } from './appVersion';
import { compareVersions } from './whatsNew';

describe('displayVersion', () => {
  it('shows the minor as three digits', () => {
    expect(['2.11.0', '2.9.3', '2.123.0', '3'].map(displayVersion)).toEqual(['2.011', '2.009', '2.123', '3.000']);
  });
  it('still compares after the two-digit versions before it', () => {
    expect(compareVersions('2.011', '2.10')).toBeGreaterThan(0);
    expect(compareVersions('2.011', '2.012')).toBeLessThan(0);
  });
});
