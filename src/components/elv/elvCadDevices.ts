import { buildingInfoOf } from '../../calc/building';
import type { ElvSystem } from '../../elv/defaults';
import { ELV_DEVICES, type ElvDeviceType } from '../../elv/devices';
import { moveDevice, placeDevices, removeDevices } from '../../elv/placed';
import type { Project } from '../../types';

/** ELV devices in the CAD view: the palette and placing / moving / deleting them through the ELV placement
 * (`project.elvDevices`), so the ELV schedules and estimate count them. Shapes match the LV side's palette items and
 * placed items (src/model/cadDevices.ts), so the CAD page lists both together. */

type Level = { building: string; level: string };
export interface ElvPaletteItem { id: string; label: string; kind: { elv: ElvDeviceType }; symbol: { shape: string; text: string } }
export interface ElvPlaced { key: string; id: string; what: 'elv'; x: number; y: number; label: string; detail: string; symbol: { shape: string; text: string }; room?: string }

const PICK: ElvDeviceType[] = ['smoke-detector', 'heat-detector', 'call-point', 'sounder', 'camera', 'card-reader', 'data-outlet', 'access-point', 'ceiling-speaker'];
export const ELV_PALETTE: ElvPaletteItem[] = PICK.map((t) => ({ id: t, label: ELV_DEVICES[t].label, kind: { elv: t }, symbol: ELV_DEVICES[t].symbol }));

export function placeElv(p: Project, type: ElvDeviceType, level: Level, x: number, y: number): { project: Project; message: string } {
  const { project } = placeDevices(p, level.building, level.level, [{ type, x, y }]);
  return { project, message: `${ELV_DEVICES[type].label} placed` };
}
/** The ELV system a device belongs to (its coverage and Copy to level go by it). */
export const elvSystemOf = (type: ElvDeviceType): ElvSystem => ELV_DEVICES[type].system;

export const moveElv = (p: Project, id: string, x: number, y: number) => moveDevice(p, id, x, y);
export const removeElv = (p: Project, id: string) => removeDevices(p, [id]);

export function elvPlacedOn(p: Project, level: Level): ElvPlaced[] {
  const rooms = buildingInfoOf(p).rooms;
  return (p.elvDevices ?? []).filter((d) => d.buildingId === level.building && d.levelId === level.level).map((d) => ({
    key: `elv:${d.id}`, id: d.id, what: 'elv' as const, x: d.x, y: d.y, label: ELV_DEVICES[d.type].label, detail: ELV_DEVICES[d.type].system.replace(/-/g, ' '),
    symbol: ELV_DEVICES[d.type].symbol, room: d.roomId ? rooms.find((r) => r.id === d.roomId)?.name : undefined
  }));
}
