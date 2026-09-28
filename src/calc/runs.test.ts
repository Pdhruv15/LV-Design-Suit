import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { evaluateProject } from './electrical';
import { runCalculations, staleStudies, STUDY_KEYS } from './runs';
import type { Feeder, Project } from '../types';

const change = (id: string, patch: Partial<Feeder>): Project => ({
  ...sampleProject,
  feeders: sampleProject.feeders.map((f) => (f.id === id ? { ...f, ...patch } : f))
});

describe('calculations on demand', () => {
  const run = runCalculations(sampleProject);

  it('a run holds every study for the project it was computed from', () => {
    expect(run.project).toBe(sampleProject);
    expect(run.results).toEqual(evaluateProject(sampleProject));
    expect(run.earthing.length).toBeGreaterThan(0);
    expect(run.selectivity.length).toBeGreaterThan(0);
    expect(staleStudies(run, sampleProject)).toEqual([]);
  });

  it('before any run everything is out of date', () => {
    expect(staleStudies(undefined, sampleProject)).toEqual(STUDY_KEYS);
  });

  it('names and remarks make nothing out of date', () => {
    expect(staleStudies(run, change('MCC-WP', { name: 'Booster pump', remarks: 'by others' }))).toEqual([]);
    const renamed = { ...sampleProject, name: 'Renamed', boards: sampleProject.boards.map((b) => ({ ...b, location: 'Somewhere' })) };
    expect(staleStudies(run, renamed)).toEqual([]);
  });

  it('a load changes voltage drop, checks and sizing — not fault levels, earthing or protection', () => {
    expect(staleStudies(run, change('MCC-WP', { loadKw: 90 }))).toEqual(['vd', 'checks', 'sizing']);
  });

  it('a cable changes voltage drop, fault levels, checks, earthing and protection — not sizing', () => {
    expect(staleStudies(run, change('INC-GF', { lengthM: 80 }))).toEqual(['vd', 'fault', 'checks', 'earthing', 'protection']);
  });

  it('a breaker rating changes checks, earthing and protection — not voltage drop or fault levels', () => {
    expect(staleStudies(run, change('GF-HVAC', { breakerRatingA: 315 }))).toEqual(['checks', 'earthing', 'protection']);
  });

  it('a transformer changes the network studies; a generator only sizing', () => {
    const tx = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === 'MDB-1' ? { ...b, sourceKva: 1500 } : b)) };
    expect(staleStudies(run, tx)).toEqual(STUDY_KEYS);
    const gen = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === 'MCC-1' ? { ...b, standby: { kva: 200 } } : b)) };
    expect(staleStudies(run, gen)).toEqual(['sizing']);
  });

  it('undoing back to the run inputs is up to date again', () => {
    const edited = change('MCC-WP', { loadKw: 90 });
    const back = change('MCC-WP', { loadKw: 75 });
    expect(staleStudies(run, edited)).not.toEqual([]);
    expect(staleStudies(run, back)).toEqual([]);
  });
});
