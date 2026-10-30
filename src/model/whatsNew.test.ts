import { readFileSync } from 'node:fs';
import { displayVersion } from './appVersion';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersions, RELEASES, unseenReleases, type Release } from './whatsNew';

const r = (version: string): Release => ({ version, date: '2026-10-28', items: [{ title: version, text: '' }] });
const list = [r('1.86'), r('1.85'), r('1.84')];

describe("What's new", () => {
  it('lists the newest release first and keeps it in step with package.json', () => {
    const version = displayVersion(JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')).version);
    expect(RELEASES[0].version).toBe(version);
    for (let i = 1; i < RELEASES.length; i += 1) expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version)).toBeGreaterThan(0);
    for (const rel of RELEASES) expect(rel.items.length).toBeGreaterThan(0);
  });

  it('compares versions as numbers', () => {
    expect(compareVersions('1.9', '1.84')).toBeLessThan(0);
    expect(compareVersions('1.100', '1.99')).toBeGreaterThan(0);
    expect(compareVersions('2.0', '1.100')).toBeGreaterThan(0); // the move to 2.0 after 1.100
    expect(compareVersions('1.84', '1.84.0')).toBe(0);
  });

  it('shows what this computer has not seen, up to the running version', () => {
    expect(unseenReleases('1.84', '1.86', true, list).map((x) => x.version)).toEqual(['1.86', '1.85']);
    expect(unseenReleases('1.86', '1.86', true, list)).toEqual([]);
    expect(unseenReleases('1.84', '1.85', true, list).map((x) => x.version)).toEqual(['1.85']);
  });

  it('shows the running version after an update from before What\'s new, and nothing on a new install', () => {
    expect(unseenReleases(undefined, '1.85', true, list).map((x) => x.version)).toEqual(['1.85']);
    expect(unseenReleases(undefined, '1.85', false, list)).toEqual([]);
  });
});
