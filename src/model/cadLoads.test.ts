import { describe, expect, it } from 'vitest';
import { applyCadLoads, findCircuit, pullCadLoads, resolveBlock, type CadBlock } from './cadLoads';
import { addCircuit, updateCircuit } from './schedule';
import { circuitRef, circuitWatts } from '../calc/loadSchedule';
import type { LibraryLoad } from '../database/database';
import type { Project } from '../types';

const loads: LibraryLoad[] = [
  { reference: 'L1', name: 'Downlight 10 W', column: 'ltg', watts: 10 },
  { reference: 'L4', name: 'Linear 18 W', column: 'ltg', watts: 18 },
  { reference: 'S13', name: 'Socket 13 A', column: 's13', watts: 250 },
  { reference: 'X9', name: 'No column', watts: 5 }
];

function base(): Project {
  return {
    name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
    boards: [
      { id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 },
      { id: 'DB-GF1', name: 'Ground floor DB', upstreamId: 'MDB', ratedCurrentA: 100, pointWatts: { ltg: 100, s13: 250 } },
      { id: 'DB-GF', name: 'Other DB', upstreamId: 'MDB', ratedCurrentA: 100 }
    ],
    feeders: [
      { id: 'INC', boardId: 'MDB', name: 'Incomer', loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 30, cableCsaMm2: 35, cores: 4, breakerRatingA: 100, breakerIcuKa: 36, feedsBoardId: 'DB-GF1' }
    ],
    cadBlocks: [{ block: 'SKT-TWIN', reference: 'S13', per: 2 }, { block: 'FIX-OLD', reference: 'GONE' }]
  };
}

/** Base project with two circuits on DB-GF1: a lighting circuit (10 × LTG) and a socket circuit. */
function project() {
  let p = base();
  const a = addCircuit(p, 'DB-GF1'); p = updateCircuit(a.project, a.id, { points: { ltg: 10 } });
  const b = addCircuit(p, 'DB-GF1'); p = updateCircuit(b.project, b.id, { points: { s13: 2 } });
  const ref = (id: string) => circuitRef(p.feeders.find((f) => f.id === id)!)!;
  return { p, light: a.id, socket: b.id, lightRef: ref(a.id), socketRef: ref(b.id) };
}
const block = (name: string, cct?: string, tag = 'CCT'): CadBlock => ({ block: name, attributes: cct ? { [tag]: cct } : {} });

describe('loads from the CAD floor plan', () => {
  it('maps blocks named like a library reference, else through the project map with its count', () => {
    const p = base();
    expect(resolveBlock('l1', loads, p.cadBlocks)?.load.reference).toBe('L1');
    expect(resolveBlock('skt-twin', loads, p.cadBlocks)).toMatchObject({ load: { reference: 'S13' }, per: 2 });
    expect(resolveBlock('FIX-OLD', loads, p.cadBlocks)).toBeUndefined(); // maps to a reference the library no longer has
    expect(resolveBlock('UNKNOWN', loads, p.cadBlocks)).toBeUndefined();
  });

  it('finds the circuit from "DB/R1", "DB R1" or "db-r1", preferring the longest board ID', () => {
    const { p, light, lightRef } = project();
    for (const v of [`DB-GF1/${lightRef}`, `DB-GF1 ${lightRef}`, `db-gf1-${lightRef.toLowerCase()}`, ` DB-GF1:${lightRef} `]) expect(findCircuit(p, v)?.id).toBe(light);
    expect(findCircuit(p, 'DB-GF1/Z9')).toBeUndefined();
    expect(findCircuit(p, 'DB-XX/R1')).toBeUndefined();
    expect(findCircuit(p, 'DB-GF1')).toBeUndefined();
  });

  it('proposes CAD counts per circuit, keeps other point types, and lists what it could not place', () => {
    const { p, light, socket, lightRef, socketRef } = project();
    const blocks = [
      ...Array.from({ length: 12 }, () => block('L1', `DB-GF1/${lightRef}`)),
      block('L4', `DB-GF1/${lightRef}`, 'Circuit'), block('L4', `DB-GF1/${lightRef}`),
      block('SKT-TWIN', `DB-GF1/${socketRef}`),
      block('FIX-03', `DB-GF1/${lightRef}`), block('FIX-03', `DB-GF1/${lightRef}`),
      block('X9', `DB-GF1/${lightRef}`),
      block('L1'),
      block('L1', 'DB-GF1/Z9'),
      block('DOOR') // furniture without a circuit: ignored
    ];
    const pull = pullCadLoads(p, blocks, loads);
    expect(pull.unmapped).toEqual([{ block: 'FIX-03', count: 2 }, { block: 'X9', count: 1 }]);
    expect(pull.noCircuit).toEqual([{ block: 'L1', count: 1 }]);
    expect(pull.unknownCircuits).toEqual([{ ref: 'DB-GF1/Z9', count: 1 }]);
    expect(pull.matching).toBe(1); // the socket circuit: one twin socket = 2 × S13, as designed
    expect(pull.proposals.map((x) => x.feederId)).toEqual([light]);
    const prop = pull.proposals[0];
    expect(prop.ref).toBe(`DB-GF1 ${lightRef}`);
    expect(prop.currentText).toBe('10×LTG');
    expect(prop.proposedText).toBe('12×L1 10 W + 2×L4 18 W');
    expect(prop.currentW).toBe(1000);
    expect(prop.proposedW).toBe(156);
    expect(socket).toBeTruthy();
  });

  it('shows the circuit’s other points beside the items CAD replaces', () => {
    let p = base();
    const a = addCircuit(p, 'DB-GF1'); p = updateCircuit(a.project, a.id, { points: { ltg: 8, exfan: 1 } });
    const ref = circuitRef(p.feeders.find((f) => f.id === a.id)!)!;
    const prop = pullCadLoads(p, Array.from({ length: 8 }, () => block('L1', `DB-GF1/${ref}`)), loads).proposals[0];
    expect(prop.currentText).toBe('8×LTG + 1×EXFAN');
    expect(prop.proposedText).toBe('8×L1 10 W + 1×EXFAN');
  });

  it('applies accepted proposals through the schedule edit', () => {
    const { p, light, lightRef } = project();
    const pull = pullCadLoads(p, Array.from({ length: 3 }, () => block('L1', `DB-GF1/${lightRef}`)), loads);
    const next = applyCadLoads(p, pull.proposals);
    const f = next.feeders.find((x) => x.id === light)!;
    expect(f.points?.ltg).toBe(3);
    expect(f.loadItems).toEqual([{ reference: 'L1', name: 'Downlight 10 W', pointType: 'ltg', quantity: 3, unitWatts: 10 }]);
    expect(circuitWatts(f, next.boards[1])).toBe(30);
    expect(f.loadKw).toBeCloseTo(0.03);
    // Pulling the same plan again finds nothing to change.
    expect(pullCadLoads(next, Array.from({ length: 3 }, () => block('L1', `DB-GF1/${lightRef}`)), loads)).toMatchObject({ proposals: [], matching: 1 });
  });
});
