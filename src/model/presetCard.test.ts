import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS, presetCard, type FeederPreset } from './presets';

const by = (id: string) => presetCard(BUILT_IN_PRESETS.find((p) => p.id === id)!);
const nb = (s: string) => s.replace(/\u00a0/g, ' ');

describe('palette cards', () => {
  it('lead with the equipment, value on the right, protection underneath', () => {
    const ahu = by('bi-ahu');
    expect(ahu.title).toBe('AHU');
    expect(nb(ahu.value!)).toBe('30 kW');
    expect(ahu.parts.map(nb)).toEqual(['MCCB', 'RCD 300 mA', 'Isolator']);
    expect(by('bi-pump').parts).toContain('Star-delta');
  });
  it('keeps number and unit together and 30 / 300 mA distinct', () => {
    expect(by('bi-sockets').parts).toContain('RCD 30 mA');
    expect(by('bi-ahu').parts).toContain('RCD 300 mA');
  });
  it('boards show their type and rating', () => {
    const db = by('bi-db');
    expect(db.title).toBe('DB');
    expect(nb(db.value!)).toBe('63 A');
    expect(db.parts).toEqual(['MCCB', 'kWh meter']);
  });
  it('custom presets keep their own name; details hold the defaults', () => {
    const mine: FeederPreset = { id: 'p-1', name: 'Kitchen hood', kind: 'load', loadName: 'Hood', loadKw: 2, powerFactor: 0.9, singlePhase: true, breaker: 'MCB', lengthM: 18 };
    const c = presetCard(mine);
    expect(c.title).toBe('Kitchen hood');
    const d = Object.fromEntries(c.details.map(([k, v]) => [k, nb(v)]));
    expect(d.Load).toBe('Hood 2 kW');
    expect(d.Phase).toBe('Single-phase');
    expect(d.PF).toBe('0.9');
    expect(d['Cable length']).toBe('18 m');
  });
  it('every built-in preset gets a title and value', () => {
    for (const p of BUILT_IN_PRESETS) { const c = presetCard(p); expect(c.title).toBeTruthy(); expect(c.value).toBeTruthy(); }
  });
});
