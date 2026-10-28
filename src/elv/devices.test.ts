import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOGUE, ELV_SYSTEMS } from './defaults';
import { cameraRangeM, devicesOf, ELV_DEVICE_TYPES, ELV_DEVICES } from './devices';
import { elvBasis } from './estimate';

describe('ELV device library', () => {
  it('has one spec per type, every system covered, and a distinct symbol for each device', () => {
    expect(Object.keys(ELV_DEVICES).sort()).toEqual([...ELV_DEVICE_TYPES].sort());
    for (const t of ELV_DEVICE_TYPES) expect(ELV_DEVICES[t].type).toBe(t);
    for (const s of ELV_SYSTEMS) expect(devicesOf(s).length).toBeGreaterThan(0);
    const symbols = Object.values(ELV_DEVICES).map((d) => `${d.symbol.shape}:${d.symbol.text}:${!!d.symbol.filled}`);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('takes loads from the project catalogue, so a project override reaches placed devices', () => {
    expect(ELV_DEVICES['smoke-detector'].load(DEFAULT_CATALOGUE)).toEqual({ loop: true, quiescentMa: 0.3, alarmMa: 5 });
    expect(ELV_DEVICES['sounder-beacon'].load(DEFAULT_CATALOGUE).alarmMa).toBe(25);
    expect(ELV_DEVICES.camera.load(DEFAULT_CATALOGUE)).toEqual({ port: true, watts: 12.95 });
    const { catalogue } = elvBasis({ catalogue: { cctv: { cameraW: 25.5 }, fireAlarm: { callPointAlarmMa: 4 } } });
    expect(ELV_DEVICES.camera.load(catalogue).watts).toBe(25.5);
    expect(ELV_DEVICES['call-point'].load(catalogue).alarmMa).toBe(4);
    // Every fire alarm device sits on a loop; nothing else does.
    for (const d of Object.values(ELV_DEVICES)) expect(!!d.load(DEFAULT_CATALOGUE).loop).toBe(d.system === 'fire-alarm');
  });

  it('gives camera ranges per IEC 62676-4 class from resolution and view angle', () => {
    // 1920 px over 100°: scene width = 2.38 × range, so 250 px/m (identify) is met to 3.22 m.
    expect(cameraRangeM(100, 1920, 'identify')).toBeCloseTo(3.22, 2);
    expect(cameraRangeM(100, 1920, 'recognise')).toBeCloseTo(6.44, 2);
    expect(cameraRangeM(100, 1920, 'observe')).toBeCloseTo(12.89, 2);
    expect(cameraRangeM(100, 1920, 'detect')).toBeCloseTo(32.22, 2);
    expect(cameraRangeM(30, 1920, 'identify')).toBeGreaterThan(cameraRangeM(100, 1920, 'identify')); // a narrow lens sees further
  });
});
