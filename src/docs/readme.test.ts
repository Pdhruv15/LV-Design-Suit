import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { displayVersion } from '../model/appVersion';

describe('README', () => {
  const readme = readFileSync('README.md', 'utf8');
  it('states the same version as package.json, as the app shows it', () => {
    expect(readme).toContain(`**Version ${displayVersion(pkg.version)}**`);
  });
  it('does not describe the app as a scaffold', () => expect(readme).not.toMatch(/scaffold/i));
});
