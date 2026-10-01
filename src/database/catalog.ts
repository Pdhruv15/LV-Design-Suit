import type { BusbarType } from '../calc/busbar';
import type { RoomType, UnitType } from '../types';
import type { PriceList } from '../model/priceList';

/** The equipment catalogue and design rules from the database workbooks
 * (Transformers, Generators, Busbar, Equipment, RoomTypes, UnitTypes, Prices,
 * Rules). Every getter falls back to the app's built-in values when the
 * workbook is missing or empty. */

export interface CatalogTransformer { kva: number; zPct?: number; xr?: number; vectorGroup?: string; noLoadW?: number; loadLossW?: number; dims?: string; weightKg?: number; price?: number; manufacturer?: string }
export interface CatalogGenerator { kva: number; kw?: number; xdPct?: number; fuelLph?: number; dims?: string; weightKg?: number; price?: number; manufacturer?: string }
export interface CatalogBusbar extends BusbarType { material: 'cu' | 'al'; ratePerM?: number; manufacturer?: string }
export interface CatalogEquipment { category: string; description: string; rating?: string; unit?: string; price?: number; install?: number; boqKey?: string; manufacturer?: string }

export interface Catalog {
  transformers: CatalogTransformer[];
  generators: CatalogGenerator[];
  busbar: CatalogBusbar[];
  equipment: CatalogEquipment[];
  roomTypes: RoomType[];
  unitTypes: UnitType[];
  priceLists: PriceList[];
  rules: Record<string, number>;
  cableRefs: import('../model/cableRefs').CableRef[]; // CableSchedule.xlsx (blank = built-in list)
}

export const EMPTY_CATALOG: Catalog = { transformers: [], generators: [], busbar: [], equipment: [], roomTypes: [], unitTypes: [], priceLists: [], rules: {}, cableRefs: [] };
let current: Catalog = EMPTY_CATALOG;
export const catalog = () => current;
export function setCatalog(c: Catalog): void { current = c; }

/** Authority / company rules (Rules.xlsx), with the app's defaults. */
export const RULES: { key: string; label: string; unit: string; value: number }[] = [
  { key: 'pfMinimum', label: 'Minimum power factor (authority)', unit: '', value: 0.9 },
  { key: 'motorStartVdLimitPct', label: 'Voltage drop while a motor starts', unit: '%', value: 10 },
  { key: 'maxLtgPerCircuit', label: 'Lighting points per circuit (max)', unit: 'points', value: 10 },
  { key: 'maxS13PerCircuit', label: '13 A socket-outlets per circuit (max)', unit: 'points', value: 6 },
  { key: 'meter1PhMaxKw', label: '1-phase kWh meter up to', unit: 'kW', value: 13 },
  { key: 'meter3PhMaxKw', label: '3-phase direct kWh meter up to (above: CT)', unit: 'kW', value: 70 },
  { key: 'wattsLtg', label: 'Lighting point (generated DBs)', unit: 'W', value: 40 },
  { key: 'wattsS13', label: '13 A socket-outlet (generated DBs)', unit: 'W', value: 200 },
  { key: 'wattsWh', label: 'Water heater (generated DBs)', unit: 'W', value: 1500 },
  { key: 'wattsCooker', label: 'Cooker (generated DBs)', unit: 'W', value: 3000 },
  { key: 'wattsExfan', label: 'Exhaust fan (generated DBs)', unit: 'W', value: 40 }
];
export const rule = (key: string): number => current.rules[key] ?? RULES.find((r) => r.key === key)?.value ?? NaN;

export const transformerFor = (kva: number) => current.transformers.find((t) => t.kva === kva);
export const generatorFor = (kva: number) => current.generators.find((g) => g.kva === kva);

/** Catalogue price for a BOQ item key (Equipment BOQ key, transformer, generator, busway). */
export function catalogRate(key: string): { rate: number; install?: number } | undefined {
  const e = current.equipment.find((x) => x.boqKey && x.boqKey === key && x.price !== undefined);
  if (e) return { rate: e.price!, install: e.install };
  const [kind, a, b] = key.split(':');
  if (kind === 'tx') { const t = transformerFor(Number(a)); if (t?.price !== undefined) return { rate: t.price }; }
  if (kind === 'gen') { const g = generatorFor(Number(a)); if (g?.price !== undefined) return { rate: g.price }; }
  if (kind === 'busway') { const r = current.busbar.find((x) => x.material === a && x.ratingA === Number(b)); if (r?.ratePerM !== undefined) return { rate: r.ratePerM }; }
  return undefined;
}
