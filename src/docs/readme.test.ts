import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';

describe('README', () => {
  const readme = readFileSync('README.md', 'utf8');
  it('states the same major.minor version as package.json', () => {
    const [major, minor] = pkg.version.split('.');
    expect(readme).toContain(`**Version ${major}.${minor}**`);
  });
  it('does not describe the app as a scaffold', () => expect(readme).not.toMatch(/scaffold/i));
});
