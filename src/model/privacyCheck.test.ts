import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript CI script, no declaration file
import { DEVICE_EMAIL, pdfText, scanText, shorten } from '../../scripts/check-privacy.mjs';

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

  it('scans PDF text streams decoded, not their encoded bytes or image data', () => {
    // ASCII85 of Flate data, as ReportLab writes it: the encoded text itself is address-like by chance.
    const a85 = (b: Buffer) => {
      let s = '';
      for (let i = 0; i < b.length; i += 4) {
        const g = Buffer.concat([b.subarray(i, i + 4), Buffer.alloc(4)]).subarray(0, 4);
        let n = g.readUInt32BE(0);
        const c: string[] = [];
        for (let k = 0; k < 5; k++) { c.unshift(String.fromCharCode((n % 85) + 33)); n = Math.floor(n / 85); }
        s += c.join('').slice(0, Math.min(4, b.length - i) + 1);
      }
      return s + '~>';
    };
    const stream = (head: string, body: string) => `1 0 obj\n<< ${head} >>\nstream\n${body}\nendstream\nendobj\n`;
    const pdf = (s: string) => Buffer.from('%PDF-1.4\n' + s, 'latin1');
    const text = `BT (Contact jsmith${at}gmail.com) Tj ET`;
    expect(pdfText(pdf(stream('/Filter [ /ASCII85Decode /FlateDecode ]', a85(deflateSync(text)))))).toContain(`jsmith${at}gmail.com`);
    expect(pdfText(pdf(stream('/Filter /FlateDecode', deflateSync(text).toString('latin1'))))).toContain(`jsmith${at}gmail.com`);
    const noise = `Xq3${at}U5.cgnM 6Fk%q${at}J.Xjab`;
    expect(scanText(pdfText(pdf(stream('/Type /XObject /Subtype /Image /Filter /DCTDecode', noise))))).toEqual([]);
    expect(scanText(pdfText(pdf(stream('/Filter /ASCII85Decode', 'not ascii85 ' + noise))))).toEqual([]);
    expect(scanText(pdfText(pdf(`2 0 obj\n<< /Author (jsmith${at}gmail.com) >>\nendobj\n`))).length).toBe(1);
  });

  it('never prints a whole value', () => {
    expect(shorten('abcdefghijklmnop')).toBe('abcdef…nop');
    expect(shorten('abc')).toBe('ab…');
  });
});
