import { describe, expect, it } from 'vitest';
import { dashedRuns } from './svgDash';

describe('editable dash geometry', () => {
  it('carries a dash through a corner without restarting its pattern', () => {
    expect(dashedRuns([[0, 0], [4, 0], [4, 8]], [6, 3])).toEqual([
      [[0, 0], [4, 0], [4, 2]], [[4, 5], [4, 8]]
    ]);
  });
  it('repeats an odd pattern and ignores zero-length path edges', () => {
    expect(dashedRuns([[0, 0], [0, 0], [12, 0]], [3])).toEqual([
      [[0, 0], [3, 0]], [[6, 0], [9, 0]]
    ]);
  });
  it('handles zero gaps and safely falls back for invalid or negligible patterns', () => {
    expect(dashedRuns([[0, 0], [5, 0]], [2, 0])).toEqual([
      [[0, 0], [2, 0]], [[2, 0], [4, 0]], [[4, 0], [5, 0]]
    ]);
    for (const pattern of [[], [0, 0], [-1, 2], [NaN, 2], Array(20).fill(1e-10)]) {
      expect(dashedRuns([[0, 0], [5, 0]], pattern)).toEqual([[[0, 0], [5, 0]]]);
    }
  });
});
