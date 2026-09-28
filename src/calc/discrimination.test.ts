import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { discriminationChain, evaluateSelectivity, selectivityPair, upstreamBreakers } from './protection';

const f = (id: string) => sampleProject.feeders.find((x) => x.id === id)!;

describe('discrimination along a feeder', () => {
  it('lists the breakers above a circuit, nearest first, up to the main board', () => {
    expect(upstreamBreakers(sampleProject, f('DB-GF1-R3')).map((x) => x.id)).toEqual(['INC-DBGF1', 'INC-GF']);
    expect(upstreamBreakers(sampleProject, f('GF-HVAC')).map((x) => x.id)).toEqual(['INC-GF']);
    expect(upstreamBreakers(sampleProject, f('INC-GF'))).toEqual([]);
  });

  it('checks each breaker with the one above it', () => {
    const chain = discriminationChain(sampleProject, f('DB-GF1-R3'));
    expect(chain.map((r) => `${r.downstream.id}<${r.upstream.id}`)).toEqual(['DB-GF1-R3<INC-DBGF1', 'INC-DBGF1<INC-GF']);
    expect(chain[0].ratio).toBeCloseTo(100 / 40, 9);
    expect(discriminationChain(sampleProject, f('INC-GF'))).toEqual([]);
  });

  it('matches the Protection study for the same pair', () => {
    const study = evaluateSelectivity(sampleProject).find((r) => r.upstream.id === 'INC-GF' && r.downstream.id === 'GF-HVAC')!;
    expect(selectivityPair(sampleProject, f('INC-GF'), f('GF-HVAC'))).toEqual(study);
  });

  it('flags a downstream breaker as large as the one above it', () => {
    const p = { ...sampleProject, feeders: sampleProject.feeders.map((x) => (x.id === 'GF-HVAC' ? { ...x, breakerRatingA: 500 } : x)) };
    expect(discriminationChain(p, p.feeders.find((x) => x.id === 'GF-HVAC')!)[0].status).toBe('bad');
  });
});
