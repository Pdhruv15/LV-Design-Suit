import { describe, expect, it } from 'vitest';
import { sldDevices } from './sldDevices';
import type { Feeder } from '../types';

const f = (p: Partial<Feeder>) => ({ id: 'F1', loadKw: 5, ...p }) as Feeder;

describe('sldDevices', () => {
  it('uses the feeder settings by default', () => {
    expect(sldDevices(f({ rcdMa: 30 })).elcb).toEqual({ label: 'ELCB', ma: 30 });
    expect(sldDevices(f({})).elcb).toBeUndefined();
  });
  it('lets remarks set and suppress devices', () => {
    expect(sldDevices(f({ remarks: 'RCBO 100mA' })).elcb).toEqual({ label: 'RCBO', ma: 100 });
    expect(sldDevices(f({ rcdMa: 30, remarks: 'no elcb' })).elcb).toBeUndefined();
  });
  it('boxes a motor starter, overridable from remarks', () => {
    expect(sldDevices(f({ loadType: 'motor' })).starter).toBe('DOL');
    expect(sldDevices(f({ loadType: 'motor', remarks: 'VFD' })).starter).toBe('VFD');
    expect(sldDevices(f({ loadType: 'motor', remarks: 'no starter' })).starter).toBeUndefined();
  });
});

describe('sldDevices extras', () => {
  it('adds UVR and TIMER from remarks', () => {
    expect(sldDevices(f({ remarks: 'UVR + timer' })).extras).toEqual(['UVR', 'TIMER']);
    expect(sldDevices(f({})).extras).toEqual([]);
  });
});
