import { describe, expect, it } from 'vitest';
import { MAX_STEPS, record, redo, reset, undo } from './history';

describe('undo / redo', () => {
  it('undoes and redoes steps in order', () => {
    let h = reset('a');
    h = record(h, 'b', 1000);
    h = record(h, 'c', 3000);
    expect(h.present).toBe('c');
    h = undo(h);
    expect(h.present).toBe('b');
    h = undo(h);
    expect(h.present).toBe('a');
    expect(undo(h)).toBe(h); // nothing left
    h = redo(redo(h));
    expect(h.present).toBe('c');
    expect(redo(h)).toBe(h);
  });

  it('a new change after undo drops the redo steps', () => {
    let h = record(record(reset(1), 2, 1000), 3, 3000);
    h = record(undo(h), 9, 5000);
    expect([h.past, h.present, h.future]).toEqual([[1, 2], 9, []]);
  });

  it('changes close together are one step', () => {
    let h = record(reset('a'), 'b', 1000);
    h = record(h, 'bc', 1200);
    h = record(h, 'bcd', 1400);
    expect(undo(h).present).toBe('a');
    h = record(h, 'x', 5000);
    expect(undo(h).present).toBe('bcd');
  });

  it('a forced step is never merged', () => {
    const h = record(record(reset('a'), 'b', 1000), 'c', 1100, 0);
    expect(undo(h).present).toBe('b');
  });

  it('the same value is not a step, and history is capped', () => {
    const h = reset({ v: 1 });
    expect(record(h, h.present, 10)).toBe(h);
    let big = reset(0);
    for (let i = 1; i <= MAX_STEPS + 20; i++) big = record(big, i, i * 1000);
    expect(big.past).toHaveLength(MAX_STEPS);
  });
});
