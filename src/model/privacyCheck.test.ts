import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript CI script, no declaration file
import { DEVICE_EMAIL, scanText, shorten } from '../../scripts/check-privacy.mjs';

// The strings are built from parts so that this file does not itself trip the scan it tests.
const at = '@';
const users = '/Us' + 'ers/';

describe('privacy check (scripts/check-privacy.mjs)', () => {
  it('finds personal absolute paths, not placeholders', () => {
    const hits = scanText([`see ${users}jsmith/Projects/app/src/a.ts`, `${users}x/a.txt`, `${users}<user>/b`, 'C:\\' + 'Users\\jsmith\\Desktop', '/ho' + 'me/runner/work', 'src/calc/a.ts'].join('\n'));
    expect(hits.map((h: { line: number; kind: string }) => [h.line, h.kind])).toEqual([[1, 'personal path'], [4, 'personal path']]);
  });

  it('finds personal e-mail addresses, not no-reply, example or package names', () => {
    const text = [`mail jsmith${at}gmail.com`, `1234+me${at}users.noreply.github.com`, `a${at}example.com`, `noreply${at}anthropic.com`, '"@types/node": "^20"', 'pkg@1.2.3'].join('\n');
    expect(scanText(text).map((h: { line: number }) => h.line)).toEqual([1]);
  });

  it('recognises addresses Git makes from a computer name', () => {
    for (const e of [`me${at}Mac.lan`, `me${at}Someones-MacBook-Air.local`, `me${at}DESKTOP-1234`]) expect(DEVICE_EMAIL.test(e)).toBe(true);
    for (const e of [`1234+me${at}users.noreply.github.com`, `me${at}company.com`]) expect(DEVICE_EMAIL.test(e)).toBe(false);
  });

  it('never prints a whole value', () => {
    expect(shorten('abcdefghijklmnop')).toBe('abcdef…nop');
    expect(shorten('abc')).toBe('ab…');
  });
});
