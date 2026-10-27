import { z } from 'zod';

/** Exchange packages between LV Design Studio and other programs, contract version 1: room schedules from CAD / BIM,
 * luminaire schedules (DIALux) and upstream loads (ELV). SI units at the boundary: m², W, kW, V. A package is only a
 * proposal until the engineer accepts it (inbox.ts). The JSON Schema files in contracts/ are generated from these
 * definitions (contracts.test.ts), so programs in other languages read the same rules. */

export const EXCHANGE_SCHEMA = 'lvds.exchange' as const;
export const EXCHANGE_VERSION = 1 as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const positive = (max: number) => z.number().positive().max(max);
const pf = z.number().gt(0).max(1).describe('Power factor');

export const SOURCE_APPS = ['cad', 'ifc', 'dialux', 'elv', 'lvds'] as const;
export const ELV_SYSTEMS = ['fire-alarm', 'cctv', 'access-control', 'ict', 'public-address', 'bms', 'other'] as const;
export const ELV_EQUIPMENT = ['panel', 'psu', 'poe-switch', 'ups', 'rack', 'amplifier', 'other'] as const;

const source = z.object({
  app: z.enum(SOURCE_APPS).describe('Program that wrote the package'),
  file: text(260).optional().describe('Drawing, model or project file it was read from; needed to recognise rooms no longer in it'),
  revision: text(60).optional().describe('Revision of that file'),
  tool: text(120).optional().describe('Name and version of the exporter')
}).strict();

const header = {
  schema: z.literal(EXCHANGE_SCHEMA),
  version: z.literal(EXCHANGE_VERSION),
  project: z.object({ id: text(80).optional(), name: text(200).optional() }).strict().optional(),
  source,
  exportedAt: z.iso.datetime({ offset: true }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional().describe('SHA-256 of the package without this field, keys sorted (canonicalJson)')
};

export const roomItem = z.object({
  sourceId: text(80).describe('Stable ID in the source: IFC GlobalId, CAD outline handle, or LV room ID'),
  building: text(120).describe('Building name or ID in the project'),
  level: text(120).describe('Level name or ID in that building'),
  name: text(200),
  number: text(40).optional(),
  type: text(60).optional().describe('Room type ID or name'),
  netAreaM2: positive(1e6),
  count: z.number().int().min(1).max(10000).optional().describe('Identical rooms on the level')
}).strict();

export const fixtureItem = z.object({
  room: text(80).describe('Project room ID, or the sourceId of a room imported from CAD / IFC'),
  code: text(60).describe('Luminaire type code'),
  description: text(200).optional(),
  quantity: z.number().int().positive().max(100000),
  inputW: positive(1e5).describe('Input power of one luminaire, W'),
  voltageV: positive(1000).optional(),
  pf: pf.optional(),
  use: z.enum(['normal', 'emergency'])
}).strict();

export const loadItem = z.object({
  id: text(80).describe('Stable ID of the supply in the source, e.g. FA-PANEL-01'),
  system: z.enum(ELV_SYSTEMS),
  equipment: text(200).describe('What the LV circuit feeds: panel, PSU, PoE switch, UPS, rack, amplifier'),
  equipmentType: z.enum(ELV_EQUIPMENT),
  rooms: z.array(text(80)).max(5000).optional().describe('Rooms served: project room IDs or imported room sourceIds'),
  serves: z.enum(['floor', 'building']).optional().describe('A floor supply (fed from the floor DB) or a building supply (fed from the main board); absent: worked out from the rooms'),
  kW: positive(1e4).describe('Upstream AC input, kW'),
  pf: pf.optional(),
  demandBasis: text(200).describe('How the kW was worked out: duty, diversity, charging allowance'),
  supply: z.enum(['normal', 'essential']),
  backup: text(200).optional().describe('Batteries / UPS autonomy, redundancy'),
  catalogueRevision: text(60).optional()
}).strict();

export const roomsPackage = z.object({ ...header, kind: z.literal('rooms'), items: z.array(roomItem).min(1).max(20000) }).strict();
export const fixturesPackage = z.object({ ...header, kind: z.literal('fixtures'), items: z.array(fixtureItem).min(1).max(50000) }).strict();
export const loadsPackage = z.object({ ...header, kind: z.literal('loads'), items: z.array(loadItem).min(1).max(10000) }).strict();
export const exchangePackage = z.discriminatedUnion('kind', [roomsPackage, fixturesPackage, loadsPackage]);

export type RoomItem = z.infer<typeof roomItem>;
export type FixtureItem = z.infer<typeof fixtureItem>;
export type LoadItem = z.infer<typeof loadItem>;
export type ExchangePackage = z.infer<typeof exchangePackage>;
export type RoomsPackage = z.infer<typeof roomsPackage>;
export type PackageKind = ExchangePackage['kind'];
export type PackageSource = ExchangePackage['source'];

/** JSON with object keys sorted at every depth: the text a package's sha256 is taken over. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The text hashed for a package: the package without its sha256 field. */
export const hashedText = (pkg: object): string => canonicalJson({ ...pkg, sha256: undefined });
