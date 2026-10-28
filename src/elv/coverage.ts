import { buildingInfoOf } from '../calc/building';
import type { Project } from '../types';
import type { ElvSystem, RoomRule } from './defaults';
import { ELV_DEVICES, type ElvDeviceType } from './devices';
import { elvBasis, type ElvSettings } from './estimate';
import { devicesOn, inside, type ElvDevice } from './placed';

type Pt = [number, number];

/** How much of each room on a level the placed devices of a system cover, checked over the room's real outline:
 * every sample point must be within reach of a device (detectors and speakers in the same room; Wi-Fi from anywhere on
 * the level). Rooms whose ELV rule wants none of the system (a toilet's detectors) are not checked. CCTV and access
 * control have no area coverage. */

export const COVERED_SYSTEMS: ElvSystem[] = ['fire-alarm', 'ict', 'public-address'];

export interface RoomCoverage {
  roomId: string;
  needed: boolean; // the room's rule wants this system
  pct?: number; // 0…1; absent: no outline to check against
  gaps: Pt[]; // centres of the uncovered sample squares, metres
  step: number; // their size, metres
}

/** How far a device covers: a radius, or half the diagonal of its spacing square. 0: no area coverage. */
export function reachM(type: ElvDeviceType): number {
  const c = ELV_DEVICES[type].coverage;
  return c?.kind === 'radius' ? c.m : c?.kind === 'spacing' ? c.m / Math.SQRT2 : 0;
}

const wants = (rule: RoomRule, system: ElvSystem) =>
  system === 'fire-alarm' ? rule.detector !== 'none'
    : system === 'ict' ? rule.accessPoint.m2 > 0 || rule.accessPoint.min > 0
      : system === 'public-address' ? rule.speaker.m2 > 0 || rule.speaker.min > 0 : false;

function area(pts: Pt[]): number {
  let t = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; t += x1 * y2 - x2 * y1; }
  return Math.abs(t) / 2;
}

export function levelCoverage(p: Project, buildingId: string, levelId: string, system: ElvSystem, settings: ElvSettings | undefined = p.elv): RoomCoverage[] {
  if (!COVERED_SYSTEMS.includes(system)) return [];
  const { rules } = elvBasis(settings);
  const covering = devicesOn(p, buildingId, levelId).filter((d) => ELV_DEVICES[d.type].system === system && reachM(d.type) > 0);
  return buildingInfoOf(p).rooms.filter((r) => r.buildingId === buildingId && r.levelId === levelId).map((r): RoomCoverage => {
    const needed = wants(rules[r.type] ?? rules.default, system);
    const outline = r.outline;
    if (!needed || !outline || outline.length < 3) return { roomId: r.id, needed, gaps: [], step: 0 };
    // Wi-Fi reaches through walls; detectors and speakers cover their own room.
    const from: ElvDevice[] = system === 'ict' ? covering : covering.filter((d) => d.roomId === r.id);
    const step = Math.max(0.25, Math.sqrt(area(outline) / 2500)); // at most about 2,500 samples a room
    const xs = outline.map((q) => q[0]), ys = outline.map((q) => q[1]);
    const gaps: Pt[] = [];
    let n = 0;
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
      for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
        if (!inside([x, y], outline)) continue;
        n += 1;
        if (!from.some((d) => Math.hypot(d.x - x, d.y - y) <= reachM(d.type))) gaps.push([x, y]);
      }
    }
    return { roomId: r.id, needed, pct: n ? 1 - gaps.length / n : 1, gaps, step };
  });
}
