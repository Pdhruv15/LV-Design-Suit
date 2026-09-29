import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { newProject } from '../types';
import { runCalculations } from '../calc/runs';
import { QUICK_PATHS, startChecklist, WORKFLOW } from './guide';

describe('help guide', () => {
  it('workflow 1–8 and quick paths', () => {
    expect(WORKFLOW.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(QUICK_PATHS.length).toBeGreaterThan(8);
  });
  it('checklist ticks itself from the project', () => {
    const fresh = startChecklist(newProject('x'));
    expect(fresh.filter((x) => x.done).map((x) => x.id)).toEqual(['tx']);
    const s = startChecklist(sampleProject, runCalculations(sampleProject), [], true);
    expect(s.find((x) => x.id === 'run')!.done).toBe(true);
    expect(s.find((x) => x.id === 'boards')!.done).toBe(true);
    expect(s.find((x) => x.id === 'saved')!.done).toBe(true);
    expect(s.find((x) => x.id === 'rev')!.done).toBe(false);
  });
});
