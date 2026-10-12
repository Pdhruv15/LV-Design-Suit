import { describe, expect, it } from 'vitest';
import { wrapText } from './SingleLineDiagram';

describe('wrapText', () => {
  it('keeps short text on one line', () => expect(wrapText('Lab', 24)).toEqual(['Lab']));
  it('wraps at word boundaries onto two lines', () => expect(wrapText('Incomer to Ground floor SMDB', 24)).toEqual(['Incomer to Ground floor', 'SMDB']));
  it('ends with an ellipsis when it needs more lines', () => {
    const out = wrapText('EV charging — parking level basement two east side', 20);
    expect(out).toHaveLength(2);
    expect(out[1].endsWith('…')).toBe(true);
    expect(out.every((l) => l.length <= 20)).toBe(true);
  });
  it('cuts a single word longer than a line', () => expect(wrapText('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10)).toEqual(['ABCDEFGHI…']));
  it('handles empty text', () => expect(wrapText('', 10)).toEqual(['']));
});
