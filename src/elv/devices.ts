import type { Catalogue, ElvSystem } from './defaults';

/** The ELV device library for designing on the floor plan: every device the engineer places, with its system, its
 * plan symbol, what it draws (from the project's ELV catalogue, defaults.ts) and how far it covers. Symbols are plain
 * geometric shapes with a letter code, in the style of the internationally used conventions (EN 54 / NFPA 170 /
 * IEC 60617); they are drawn here, not copied from any symbol library. Coverage values are the international
 * defaults, to verify for each project and authority. */

export const ELV_DEVICE_TYPES = [
  'smoke-detector', 'heat-detector', 'multi-detector', 'call-point', 'sounder', 'sounder-beacon', 'interface-module',
  'camera', 'card-reader', 'maglock', 'exit-button',
  'data-outlet', 'access-point',
  'ceiling-speaker', 'horn-speaker'
] as const;
export type ElvDeviceType = typeof ELV_DEVICE_TYPES[number];

export type SymbolShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon' | 'camera' | 'speaker';
/** A plan symbol: a shape, the letter code inside it, filled or open. */
export interface DeviceSymbol { shape: SymbolShape; text: string; filled?: boolean }

/** What one device puts on its loop, port or amplifier. */
export interface DeviceLoad {
  loop?: boolean; // an addressable fire alarm loop device (takes one address)
  quiescentMa?: number; // on the loop at 24 V DC
  alarmMa?: number;
  output?: boolean; // sounders, beacons, modules: all draw alarm current together (inputs only a few at a time)
  port?: boolean; // takes a switch port
  watts?: number; // PoE, 12 V DC or speaker tap
}

/** Pixels per metre at the target for each IEC 62676-4 (EN 62676-4) class. */
export const DORI_PX_PER_M = { detect: 25, observe: 62.5, recognise: 125, identify: 250 } as const;
export type DoriClass = keyof typeof DORI_PX_PER_M;

export type Coverage =
  | { kind: 'radius'; m: number; basis: string } // every point of the room within m of a device
  | { kind: 'travel'; m: number; basis: string } // nobody further than m (travel distance) from one
  | { kind: 'spacing'; m: number; basis: string } // devices at most m apart, and m / 2 from walls
  | { kind: 'cone'; fovDeg: number; pixelsH: number; basis: string }; // range per class from cameraRangeM

export interface ElvDeviceSpec {
  type: ElvDeviceType;
  system: ElvSystem;
  label: string;
  symbol: DeviceSymbol;
  load: (c: Catalogue) => DeviceLoad;
  coverage?: Coverage;
}

const BS5839 = 'BS 5839-1 / EN 54 practice';

export const ELV_DEVICES: Record<ElvDeviceType, ElvDeviceSpec> = {
  'smoke-detector': {
    type: 'smoke-detector', system: 'fire-alarm', label: 'Smoke detector', symbol: { shape: 'circle', text: 'S' },
    load: (c) => ({ loop: true, quiescentMa: c.fireAlarm.detectorQuiescentMa, alarmMa: c.fireAlarm.detectorAlarmMa }),
    coverage: { kind: 'radius', m: 7.5, basis: `Point smoke detector, flat ceiling: 7.5 m radius (${BS5839})` }
  },
  'heat-detector': {
    type: 'heat-detector', system: 'fire-alarm', label: 'Heat detector', symbol: { shape: 'circle', text: 'H' },
    load: (c) => ({ loop: true, quiescentMa: c.fireAlarm.detectorQuiescentMa, alarmMa: c.fireAlarm.detectorAlarmMa }),
    coverage: { kind: 'radius', m: 5.3, basis: `Point heat detector, flat ceiling: 5.3 m radius (${BS5839})` }
  },
  'multi-detector': {
    type: 'multi-detector', system: 'fire-alarm', label: 'Multi-sensor detector', symbol: { shape: 'circle', text: 'M' },
    load: (c) => ({ loop: true, quiescentMa: c.fireAlarm.detectorQuiescentMa, alarmMa: c.fireAlarm.detectorAlarmMa }),
    coverage: { kind: 'radius', m: 7.5, basis: `Multi-sensor in smoke mode: 7.5 m radius (${BS5839})` }
  },
  'call-point': {
    type: 'call-point', system: 'fire-alarm', label: 'Manual call point', symbol: { shape: 'square', text: 'CP' },
    load: (c) => ({ loop: true, quiescentMa: c.fireAlarm.callPointQuiescentMa, alarmMa: c.fireAlarm.callPointAlarmMa }),
    coverage: { kind: 'travel', m: 45, basis: `At each exit; nobody more than 45 m travel distance from one (${BS5839})` }
  },
  sounder: {
    type: 'sounder', system: 'fire-alarm', label: 'Sounder', symbol: { shape: 'triangle', text: 'SD' },
    load: (c) => ({ loop: true, output: true, quiescentMa: c.fireAlarm.sounderQuiescentMa, alarmMa: c.fireAlarm.sounderAlarmMa })
    // Coverage is a sound level (65 dB(A), or 5 dB above ambient; 75 dB(A) at the bedhead), not a distance.
  },
  'sounder-beacon': {
    type: 'sounder-beacon', system: 'fire-alarm', label: 'Sounder beacon', symbol: { shape: 'triangle', text: 'SB', filled: true },
    load: (c) => ({ loop: true, output: true, quiescentMa: c.fireAlarm.sounderQuiescentMa, alarmMa: c.fireAlarm.sounderAlarmMa + c.fireAlarm.beaconAlarmMa })
  },
  'interface-module': {
    type: 'interface-module', system: 'fire-alarm', label: 'Interface module', symbol: { shape: 'square', text: 'IM' },
    load: (c) => ({ loop: true, output: true, quiescentMa: c.fireAlarm.moduleQuiescentMa, alarmMa: c.fireAlarm.moduleAlarmMa })
  },
  camera: {
    type: 'camera', system: 'cctv', label: 'CCTV camera', symbol: { shape: 'camera', text: 'C' },
    load: (c) => ({ port: true, watts: c.cctv.cameraW }),
    coverage: { kind: 'cone', fovDeg: 100, pixelsH: 1920, basis: '1080p, 100° horizontal view; range per IEC 62676-4 class' }
  },
  'card-reader': {
    type: 'card-reader', system: 'access-control', label: 'Card reader', symbol: { shape: 'square', text: 'CR' },
    load: (c) => ({ watts: c.access.readerW })
  },
  maglock: {
    type: 'maglock', system: 'access-control', label: 'Magnetic lock', symbol: { shape: 'square', text: 'ML', filled: true },
    load: (c) => ({ watts: c.access.lockW })
  },
  'exit-button': {
    type: 'exit-button', system: 'access-control', label: 'Exit button', symbol: { shape: 'circle', text: 'EX' },
    load: () => ({ watts: 0 })
  },
  'data-outlet': {
    type: 'data-outlet', system: 'ict', label: 'Data outlet', symbol: { shape: 'triangle', text: 'D' },
    load: () => ({ port: true, watts: 0 })
  },
  'access-point': {
    type: 'access-point', system: 'ict', label: 'Wi-Fi access point', symbol: { shape: 'hexagon', text: 'AP' },
    load: (c) => ({ port: true, watts: c.ict.accessPointW }),
    coverage: { kind: 'radius', m: 12, basis: 'Typical indoor cell, 12 m radius; verify with a survey or predictive design' }
  },
  'ceiling-speaker': {
    type: 'ceiling-speaker', system: 'public-address', label: 'Ceiling speaker', symbol: { shape: 'speaker', text: 'SP' },
    load: (c) => ({ watts: c.pa.ceilingTapW }),
    coverage: { kind: 'spacing', m: 6, basis: 'About 2 × ceiling height (3 m); verify intelligibility (STI ≥ 0.5, EN 54-32 / BS 5839-8)' }
  },
  'horn-speaker': {
    type: 'horn-speaker', system: 'public-address', label: 'Horn speaker', symbol: { shape: 'speaker', text: 'HS', filled: true },
    load: (c) => ({ watts: c.pa.hornTapW }),
    coverage: { kind: 'spacing', m: 20, basis: 'Car parks and plant: up to 20 m apart; verify intelligibility (STI ≥ 0.5)' }
  }
};

/** How far a device covers: a radius, or half the diagonal of its spacing square. 0: no area coverage. */
export function reachM(type: ElvDeviceType): number {
  const c = ELV_DEVICES[type].coverage;
  return c?.kind === 'radius' ? c.m : c?.kind === 'spacing' ? c.m / Math.SQRT2 : 0;
}

export const devicesOf = (system: ElvSystem): ElvDeviceSpec[] => Object.values(ELV_DEVICES).filter((d) => d.system === system);

/** How far a camera meets a class: the scene width there is pixelsH ÷ px/m, and width = 2 × range × tan(fov / 2). */
export function cameraRangeM(fovDeg: number, pixelsH: number, cls: DoriClass): number {
  return pixelsH / (DORI_PX_PER_M[cls] * 2 * Math.tan((fovDeg * Math.PI) / 360));
}
