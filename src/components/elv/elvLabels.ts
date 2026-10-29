import { ELV_SYSTEMS, type ElvSystem } from '../../elv/defaults';
import { devicesOf, ELV_DEVICES, reachM, type ElvDeviceType } from '../../elv/devices';

/** Names of the ELV systems and devices for the ribbon, kept apart from the ELV engine so the app's start-up does not
 * load it (Design CAD loads it with elvPlan.ts). */

export const SYSTEM_LABEL: Record<ElvSystem, string> = {
  'fire-alarm': 'Fire alarm', cctv: 'CCTV', 'access-control': 'Access control', ict: 'Data and Wi-Fi', 'public-address': 'Public address'
};
export const SYSTEMS = ELV_SYSTEMS.map((id) => ({ id, label: SYSTEM_LABEL[id] }));
export const devicesFor = (system: ElvSystem) => devicesOf(system);
export const deviceLabel = (t: ElvDeviceType) => ELV_DEVICES[t].label;
/** Whether Fill room can place this device: only devices whose coverage sets a spacing. */
export const canFill = (t: ElvDeviceType) => reachM(t) > 0;
