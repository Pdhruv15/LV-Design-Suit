import { describe, expect, it } from 'vitest';
import { axes, blockOf, fillDownEdits, parseClipboard, parseKey, pasteEdits, toClipboard } from './excelGrid';

describe('Excel-style grid helpers', () => {
  it('reads Excel clipboard text (tabs and newlines, Windows line ends, trailing newline)', () => {
    expect(parseClipboard('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseClipboard('single')).toEqual([['single']]);
    expect(toClipboard([['1', '2'], ['3', '']])).toBe('1\t2\n3\t');
  });

  it('pastes a block following the table order, skipping missing rows/columns and clipping at the edge', () => {
    const ys = [0, 2, 3, 7]; // e.g. only some schedule rows exist
    const xs = [4, 5, 8];
    expect(pasteEdits([['a', 'b'], ['c', 'd']], { y: 2, x: 5 }, ys, xs)).toEqual([
      { y: 2, x: 5, value: 'a' }, { y: 2, x: 8, value: 'b' },
      { y: 3, x: 5, value: 'c' }, { y: 3, x: 8, value: 'd' }
    ]);
    expect(pasteEdits([['a', 'b', 'c']], { y: 7, x: 5 }, ys, xs)).toEqual([{ y: 7, x: 5, value: 'a' }, { y: 7, x: 8, value: 'b' }]);
    expect(pasteEdits([['a']], { y: 1, x: 5 }, ys, xs)).toEqual([]);
  });

  it('selects a block between two corners in any direction', () => {
    const { ys, xs } = axes([{ y: 0, x: 0 }, { y: 0, x: 1 }, { y: 1, x: 0 }, { y: 1, x: 1 }, { y: 2, x: 1 }]);
    expect(blockOf({ y: 2, x: 1 }, { y: 1, x: 0 }, ys, xs)).toEqual([{ y: 1, x: 0 }, { y: 1, x: 1 }, { y: 2, x: 0 }, { y: 2, x: 1 }]);
  });

  it('fills each column’s top value down', () => {
    const block = [{ y: 3, x: 1 }, { y: 3, x: 2 }, { y: 4, x: 1 }, { y: 4, x: 2 }, { y: 5, x: 1 }, { y: 5, x: 2 }];
    const top: Record<string, string> = { '3:1': 'Bedroom', '3:2': '4' };
    expect(fillDownEdits(block, (p) => top[`${p.y}:${p.x}`] ?? 'x')).toEqual([
      { y: 4, x: 1, value: 'Bedroom' }, { y: 5, x: 1, value: 'Bedroom' },
      { y: 4, x: 2, value: '4' }, { y: 5, x: 2, value: '4' }
    ]);
  });

  it('reads cell keys', () => {
    expect(parseKey('3:12')).toEqual({ y: 3, x: 12 });
    expect(parseKey('x')).toBeUndefined();
  });
});
