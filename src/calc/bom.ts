import type { Board, Feeder, PointType, Project } from '../types';
import { BOARD_KINDS, POINT_TYPES } from '../types';
import { cableTypeOf } from '../model/cableTypes';
import { breakerTypeOf, cpcOf } from './earthing';
import { runsOf } from './electrical';
import { sizeRiser } from './busbar';
import { earthingLayout, kindInfo } from '../model/earthingPlan';
import { BRAND_DEVICES } from '../data/brandDevices';
import { matchDevice, type DeviceKind } from '../model/enclosureLibrary';
import { scheduleGroupOf } from '../model/scheduleGroups';
import { mainBoards, txTag } from '../model/transformers';
import { sizeRoute, trayPlanOf, trayQuantities } from './cableTray';
import { elcbGroups, pointLabel, scheduleCircuits } from './loadSchedule';

/** Bill of materials: every item the design already knows about, rolled up
 * into tender BOQ sections. Each item has a stable key, so a price list
 * entered once prices it on every project. */

/** Design sections A–I, optional schedule points J; custom sections follow them. */
export type BomSection = string;
export const BOM_SECTIONS: Record<string, string> = {
  A: 'Panels and switchboards',
  B: 'Switchgear and protection',
  C: 'Metering and instruments',
  D: 'Power equipment',
  E: 'Cables',
  F: 'Cable accessories',
  G: 'Busbar trunking',
  H: 'Cable containment',
  I: 'Earthing',
  J: 'Schedule points and equipment'
};

export interface BomItem {
  key: string; // stable, e.g. "cable:XLPE/PVC/SWA:4C:95"
  section: BomSection;
  description: string;
  unit: string; // no, m, set, lot, LS
  qty: number;
  where: string[]; // boards / routes / risers it comes from
  quantitySource?: string;
  supplyBy?: 'contractor' | 'client' | 'others';
  /** Who installs it, when the design knows (e.g. DEWA's RMU: others). */
  installBy?: 'contractor' | 'client' | 'others';
}

const kindOf = (b: Board) => b.kind ?? (b.upstreamId ? 'DB' : 'MDB');
const kindLabel = (k: string) => BOARD_KINDS.find((x) => x.value === k)?.label ?? k;
const isFinal = (f: Feeder) => !!f.phase;

/** Poles of a feeder's devices. */
export function polesOf(f: Feeder): string {
  if (f.phase && f.phase !== 'RYB') return 'SP';
  return f.cores === 2 ? 'SP+N' : f.cores === 3 ? 'TP' : 'TP+N';
}

const POLE_COUNT: Record<string, number> = { SP: 1, 'SP+N': 2, TP: 3, 'TP+N': 4 };
/** Manufacturer reference from the built-in device data, written "ref. … or approved equal" (never part of the key). */
export function brandRef(kind: DeviceKind, poles: string | number, ratingA: number): string {
  const d = matchDevice(BRAND_DEVICES, kind, typeof poles === 'number' ? poles : POLE_COUNT[poles] ?? 0, ratingA);
  return d ? ` — ref. ${d.manufacturer} ${d.model.replace(/\s+\S+$/, '')} or approved equal` : '';
}

export function breakerItem(f: Feeder): Pick<BomItem, 'key' | 'description'> {
  const t = f.device === 'ACB' || f.device === 'MCCB' ? f.device : breakerTypeOf(f);
  const p = polesOf(f);
  if (f.device === 'ISOL') return { key: `switch-isol:${f.breakerRatingA}:${p}`, description: `Feeder isolator ${f.breakerRatingA} A ${p}` };
  if (t === 'ACB') return { key: `acb:${f.breakerRatingA}:${p}:${f.breakerIcuKa}`, description: `ACB ${f.breakerRatingA} A ${p}, ${f.breakerIcuKa} kA, withdrawable, electronic trip unit${brandRef('ACB', p, f.breakerRatingA)}` };
  if (t === 'MCCB') return { key: `mccb:${f.breakerRatingA}:${p}:${f.breakerIcuKa}`, description: `MCCB ${f.breakerRatingA} A ${p}, ${f.breakerIcuKa} kA, adjustable thermal-magnetic${brandRef('MCCB', p, f.breakerRatingA)}` };
  return { key: `mcb:${t}:${f.breakerRatingA}:${p}:${f.breakerIcuKa}`, description: `MCB ${f.breakerRatingA} A ${p}, type ${t}, ${f.breakerIcuKa} kA${brandRef('MCB', p, f.breakerRatingA)}` };
}

/** Cable gland size by overall cable size (approximate, CW type for SWA). */
const glandSize = (csa: number, cores: number) => {
  const s = csa * cores;
  return s <= 10 ? '20S' : s <= 30 ? '20' : s <= 70 ? '25' : s <= 150 ? '32' : s <= 300 ? '40' : s <= 500 ? '50S' : s <= 750 ? '50' : s <= 1000 ? '63' : '75';
};

export function buildBom(project: Pick<Project, 'boards' | 'feeders'> & Partial<Project>): BomItem[] {
  const p = project as Project;
  const m = new Map<string, BomItem>();
  const groupedRcdCircuits = new Set<string>();
  // Items of the emergency system (EMDB and everything below it) are listed on their own lines.
  const emergency = new Set(p.boards.filter((b) => scheduleGroupOf(p, b) === 'emg').map((b) => b.id));
  const add = (section: BomSection, key0: string, description0: string, unit: BomItem['unit'], qty: number, where: string,
    basis: Pick<BomItem, 'quantitySource' | 'supplyBy' | 'installBy'> = {}) => {
    if (!(qty > 0)) return;
    const emg = emergency.has(where);
    const key = emg ? `${key0}:emg` : key0;
    const description = emg ? `Emergency system — ${description0}` : description0;
    const it = m.get(key) ?? { key, section, description, unit, qty: 0, where: [], quantitySource: 'Design model', supplyBy: 'contractor', ...basis };
    it.qty += qty;
    if (where && !it.where.includes(where)) it.where.push(where);
    m.set(key, it);
  };

  // Panels, incomers and board-mounted equipment
  for (const b of p.boards) {
    const k = kindOf(b);
    const rating = b.ratedCurrentA ?? (!b.upstreamId ? b.supply?.ratingA : undefined) ?? p.feeders.find((f) => f.feedsBoardId === b.id)?.breakerRatingA;
    const bus = b.busbarMaterial === 'aluminium' ? 'Al' : 'Cu';
    const enc = b.enclosure;
    const encText = enc ? `, enclosure ${enc.supplier} ${enc.range} ${enc.config.ref}${enc.mounting ? `, ${enc.mounting} mounted` : ''}, rev. ${enc.revision}${enc.dims ? ` (H${enc.dims.h} × W${enc.dims.w} × D${enc.dims.d} mm)` : ''}` : '';
    const encKey = enc ? `:${enc.catalogueId}:${enc.config.id}:${enc.mounting ?? '-'}:${enc.dims ? `${enc.dims.h}x${enc.dims.w}x${enc.dims.d}` : '-'}:${encodeURIComponent(enc.revision)}` : '';
    const make = [b.manufacturer, b.model].filter(Boolean).join(' ');
    const makeKey = [b.manufacturer, b.model].map((s) => encodeURIComponent(s?.trim() || '-')).join(':');
    add('A', `panel:${k}:${rating ?? '-'}:${b.ipRating ?? '-'}:${bus}:${makeKey}${encKey}`,
      `${kindLabel(k)} (${k})${rating ? `, ${rating} A` : ''}, ${bus} busbar${make ? `, ${make}` : ''}${b.ipRating ? `, ${b.ipRating}` : ''}${encText}, form of separation to spec.`, 'no', 1, b.id);
    // Extra the supplier's chart adds for the enclosure case (e.g. an 800 mm busbar).
    if (enc?.extra) add('A', `enc-extra:${enc.extra}`, enc.extra.replace(/ to add in the estimate$/, '').replace(/^./, (c) => c.toUpperCase()) + ' for the distribution board (supplier chart allowance)', 'no', 1, b.id);
    // Incomer device of a board fed from a transformer or the authority
    const incomerRating = b.supply?.ratingA ?? rating;
    if (!b.upstreamId && incomerRating) {
      const dev = b.supply?.device ?? (incomerRating > 630 ? 'ACB' : 'MCCB');
      add('B', `incomer:${dev}:${incomerRating}`, `Incomer ${dev} ${incomerRating} A 4P${dev === 'ACB' ? ', withdrawable, electronic trip unit' : ''}`, 'no', 1, b.id);
    }
    if (!b.upstreamId && b.supply?.meter) {
      const meter = b.supply.meter;
      add('C', `kwh:${meter}`, meter === 'CT' ? 'kWh meter, CT operated, with CTs and test block' : `kWh meter, direct ${meter === '1-PH' ? '1-phase' : '3-phase'}`, 'no', 1, b.id);
    }
    const circuits = scheduleCircuits(p, b.id);
    const inc = p.feeders.find((f) => f.feedsBoardId === b.id);
    const threePhase = !!inc && inc.cores >= 3 || circuits.some((c) => c.cores !== 2 || c.phase === 'RYB') || new Set(circuits.map((c) => c.phase)).size > 1;
    for (const group of elcbGroups(p, b)) {
      const poles = threePhase ? 'TP+N' : 'SP+N';
      add('B', `rccb:${group.sensitivityMa}:${poles}:${group.ratingA}`, `RCCB / ELCB ${group.sensitivityMa} mA, ${poles}, ${group.ratingA} A${brandRef('RCCB', poles, group.ratingA)}`, 'no', 1, b.id,
        { quantitySource: 'Load schedule ELCB groups' });
      group.circuits.forEach((c) => groupedRcdCircuits.add(c.id));
    }
    if (b.spd) add('B', `spd:${b.spd}`, `Surge protection device, Type ${b.spd === 'T1+2' ? '1+2' : b.spd.slice(1)}, 4P, with backup fuse / MCB`, 'no', 1, b.id);
    const prot = b.protection;
    const ct = prot?.ctRatio ?? b.supply?.ctRatio;
    if (ct) add('C', `ct:${ct}`, `Current transformers ${ct}, class 1 / 5P (set of 3)`, 'set', 1, b.id);
    for (const r of prot?.relays ?? []) add('B', `relay:${r}`, { ELR: 'Earth leakage relay with core balance CT', EFR: 'Earth fault relay', UVR: 'Under-voltage relay', OVR: 'Over-voltage relay' }[r], 'no', 1, b.id);
    if (prot?.apfc) add('C', 'pfr', 'Power factor relay (APFC controller) with CT', 'no', 1, b.id);
    if (b.standby) {
      if (b.standby.changeover === 'ACB') {
        add('B', `acb-il:${rating ?? '-'}`, `Mains / generator changeover: 2 × ACB ${rating ?? ''} A 4P with mechanical and electrical interlock`, 'set', 1, b.id);
      } else add('B', `ats:${rating ?? '-'}`, `Automatic transfer switch ${rating ?? ''} A 4P`, 'no', 1, b.id);
      add('D', `gen:${b.standby.kva}`, `Standby diesel generator ${b.standby.kva} kVA, 400/230 V, with AMF panel, fuel tank and canopy`, 'no', 1, b.id);
    }
    if ((b.instruments ?? !b.upstreamId) && p.feeders.some((f) => f.boardId === b.id)) {
      add('C', 'ammeter-ss', 'Ammeter with selector switch and CTs, 96 × 96 mm', 'no', 1, b.id);
      add('C', 'voltmeter-ss', 'Voltmeter with selector switch and protection fuses, 96 × 96 mm', 'no', 1, b.id);
      add('C', 'lamps-ryb', 'Indicating lamps R-Y-B, LED, with fuses', 'set', 1, b.id);
    }
    if (b.earthing?.show ?? !b.upstreamId) {
      const el = b.earthing?.electrodeM ?? 3;
      // With an earthing schematic, its pits are counted below instead.
      if (!p.earthingPlan) add('I', `earth-pit:${el}`, `Earth pit: ${el} m copper-bonded earth electrode with inspection pit and cover, tested`, 'no', b.earthing?.pits ?? 2, b.id);
      const inc = p.feeders.find((f) => f.feedsBoardId === b.id);
      const mm = b.earthing?.conductorMm2 ?? (inc ? Math.max(16, cpcOf(inc)) : 50);
      add('I', `met:${mm}`, `Main earth terminal bar with test link; earth conductor 1C × ${mm} mm² Cu/PVC to the pits (length to site)`, 'set', 1, b.id);
    }
    if (b.sourceKva) add('D', `tx:${b.sourceKva}:${b.sourceImpedancePct ?? '-'}`, `Distribution transformer ${b.sourceKva} kVA, 11/0.415 kV, ${b.vectorGroup ?? 'Dyn11'}${b.sourceImpedancePct ? `, Z ${b.sourceImpedancePct} %` : ''}`, 'no', 1, b.id);
    if (k === 'UPS' && b.upsKva) add('D', `ups:${b.upsKva}`, `UPS ${b.upsKva} kVA online double conversion, with batteries`, 'no', 1, b.id);
  }

  // Earth pits from the earthing schematic (RMU, transformer neutral / body, LV)
  if (p.earthingPlan) {
    const L = earthingLayout(p);
    for (const pit of L.pits) {
      const it = L.items.find((i) => i.key === pit.itemKey)!;
      add('I', `earth-pit:${L.electrodeM}:${pit.kind}`, `Earth pit (${kindInfo(pit.kind).label}): ${L.electrodeM} m copper-bonded earth electrode with inspection pit and cover, tested`, 'no', 1, it.equipment);
    }
    if (L.links.length) add('I', `earth-link:${L.conductorMm2}`, `Earth pit interconnection 1C × ${L.conductorMm2} mm² Cu (length to site)`, 'no', L.links.length, 'Earthing schematic');
  }

  // RMUs feeding the transformers (one line per RMU; normally DEWA supply)
  const rmus = new Map<string, string[]>();
  for (const b of mainBoards(p).filter((x) => x.sourceKva)) {
    const name = b.rmu?.trim() || `RMU (${txTag(p, b.id)})`;
    const key = `${b.substation?.trim() || ''}|${name}`;
    rmus.set(key, [...(rmus.get(key) ?? []), txTag(p, b.id) ?? b.id]);
  }
  for (const [key, txs] of rmus) {
    const name = key.split('|')[1];
    add('D', 'rmu:11kV', '11 kV ring main unit (RMU): 2 × ring load-break switch + 1 × T-off switch-fuse, SF6 / solid insulated, with earthing switches', 'no', 1, `${name} (${txs.join(', ')})`, { supplyBy: 'others', installBy: 'others' });
  }
  // Bus couplers between main boards (normally open)
  for (const t of p.ties ?? []) {
    const dev = t.ratingA > 630 ? 'ACB' : 'MCCB';
    add('B', `tie:${dev}:${t.ratingA}`, `Bus coupler ${dev} ${t.ratingA} A 4P, normally open, interlocked with the incomers${brandRef(dev, 3, t.ratingA)}`, 'no', 1, `${t.a} – ${t.b}`);
  }

  // Outgoing ways: breakers, earth leakage, meters, isolators, equipment
  for (const f of p.feeders) {
    const bi = breakerItem(f);
    add('B', bi.key, bi.description, 'no', 1, f.boardId);
    const poles = polesOf(f);
    if (f.rcdMa && !groupedRcdCircuits.has(f.id)) add('B', `rcd:${f.rcdMa}:${poles}:${f.breakerRatingA}`, `Earth leakage protection ${f.rcdMa} mA, ${poles}, ${f.breakerRatingA} A`, 'no', 1, f.boardId);
    if (f.kwhMeter) add('C', `kwh:${f.kwhMeter}`, f.kwhMeter === 'CT' ? 'kWh meter, CT operated, with CTs and test block' : `kWh meter, direct ${f.kwhMeter === '1-PH' ? '1-phase' : '3-phase'}`, 'no', 1, f.boardId);
    if (f.localIsolator) add('B', `iso:${f.breakerRatingA}:${poles}`, `Local isolator ${f.breakerRatingA} A ${poles}, weatherproof enclosure`, 'no', 1, f.boardId);
    if (f.kvar) add('D', `cap:${f.kvar}:${f.capSteps ?? 1}:${f.detunedPct ?? 0}`, `${f.capSteps ? 'Capacitor bank' : 'Fixed capacitor'} ${f.kvar} kvar${f.capSteps && f.capSteps > 1 ? `, ${f.capSteps} steps` : ''}${f.detunedPct ? `, ${f.detunedPct} % detuned` : ''}${f.capSteps ? ', with APFC relay' : ''}`, 'no', 1, f.boardId);

    // Cable and its earth conductor
    const runs = runsOf(f);
    const len = f.lengthM * runs;
    const t = cableTypeOf(p, f);
    if (isFinal(f)) {
      // Procurement metres of each conductor, not metres of a complete circuit.
      // Distinct keys prevent legacy circuit-route rates from silently transferring.
      const basis = { quantitySource: 'Conductor metres: circuit route length × parallel runs × conductor count; rounded up after aggregation' };
      add('E', `wire-conductor:${f.cableCsaMm2}`, `Single-core live / neutral wiring ${f.cableCsaMm2} mm² Cu/PVC (conductor metres; conduit measured separately)`, 'm', len * f.cores, f.boardId, basis);
      add('I', `cpc:${cpcOf(f)}`, `Circuit protective conductor 1C × ${cpcOf(f)} mm² Cu/PVC, green/yellow (conductor metres)`, 'm', len, f.boardId,
        { quantitySource: 'CPC conductor metres: circuit route length × parallel runs; rounded up after aggregation' });
      continue;
    }
    add('E', `cable:${t.value}:${f.cores}C:${f.cableCsaMm2}`, `${f.cores}C × ${f.cableCsaMm2} mm² Cu ${t.label.replace(/ \(.*\)$/, '')}`, 'm', len, f.boardId);
    const cpc = cpcOf(f);
    if (!!t.armoured) add('I', `ecc:${cpc}`, `Earth continuity conductor 1C × ${cpc} mm² Cu/PVC, green/yellow`, 'm', len, f.boardId);
    // Two ends per run: glands and lugs
    const g = glandSize(f.cableCsaMm2, f.cores);
    add('F', `gland:${g}:${!t.armoured ? 'A2' : 'CW'}`, `Cable gland size ${g}, ${!t.armoured ? 'A2 (unarmoured)' : 'CW (armoured)'} with shroud`, 'no', 2 * runs, f.boardId);
    add('F', `lug:${f.cableCsaMm2}`, `Crimp lug ${f.cableCsaMm2} mm² Cu`, 'no', 2 * runs * f.cores, f.boardId);
    if (!!t.armoured) add('F', `lug:${cpc}`, `Crimp lug ${cpc} mm² Cu`, 'no', 2 * runs, f.boardId);
  }

  // Point counts are opt-in: a design load does not establish who supplies the equipment.
  if (p.boq?.includeSchedulePoints) {
    const electricalPoints = new Set<PointType>(['ltg', 'shaver', 's13', 's15', 's13t', 'spur', 'isol']);
    for (const b of p.boards) for (const f of scheduleCircuits(p, b.id)) {
      for (const point of POINT_TYPES) {
        const count = f.points?.[point.value] ?? 0;
        const selected = b.pointItems?.[point.value]?.trim();
        const label = pointLabel(b, point.value, p);
        const spec = selected || (point.value === 'spare1' || point.value === 'spare2' ? label : point.title);
        const key = `point:${point.value}:${encodeURIComponent(spec)}`;
        add('J', key, `${spec} — load schedule point count${selected ? '' : '; product / scope to confirm'}`, 'no', count, b.id,
          { quantitySource: 'Load schedule point counts', supplyBy: electricalPoints.has(point.value) ? 'contractor' : 'client' });
      }
    }
  }

  // Busbar trunking risers
  for (const r of p.busRisers ?? []) {
    const s = sizeRiser(p, r);
    const mat = r.material === 'al' ? 'Al' : 'Cu';
    const rating = s.type?.ratingA;
    const tag = `${rating ?? '—'} A ${mat}`;
    add('G', `busway:${r.material}:${rating ?? '-'}`, `Busbar trunking ${tag}, straight lengths`, 'm', s.lengthM, r.name);
    add('G', `busway-el:${r.material}:${rating ?? '-'}`, `Busbar trunking ${tag}, elbow`, 'no', r.elbows, r.name);
    add('G', `busway-feed:${r.material}:${rating ?? '-'}`, `Busbar trunking ${tag}, feed unit / flanged end`, 'no', 1, r.name);
    add('G', `busway-end:${r.material}:${rating ?? '-'}`, `Busbar trunking ${tag}, end cap`, 'no', 1, r.name);
    add('G', `busway-tap:${r.material}`, `Tap-off unit with MCCB (rating to schedule), ${mat} busway`, 'no', s.tapOffs, r.name);
    add('G', 'busway-fix', 'Busbar trunking fixing / spring hangers per floor', 'no', r.floors.length + r.offsetFloors, r.name);
  }

  // Cable trays
  if (p.trays?.routes.length) {
    const plan = trayPlanOf(p);
    const q = trayQuantities(plan.routes.map((r) => sizeRoute(p, plan, r)), plan.settings);
    const kind = plan.settings.trayType || (plan.settings.kind === 'ladder' ? 'Cable ladder' : 'Perforated cable tray');
    for (const t of q) {
      const w = t.routes.join(', ');
      add('H', `tray:${plan.settings.kind}:${t.size}`, `${kind} ${t.size} mm, HDG`, 'm', t.lengthM, w);
      add('H', `tray-bend:${t.size}`, `${kind} bend 90°, ${t.size} mm`, 'no', t.bends, w);
      add('H', `tray-tee:${t.size}`, `${kind} tee, ${t.size} mm`, 'no', t.tees, w);
      add('H', `tray-red:${t.size}`, `${kind} reducer, ${t.size} mm`, 'no', t.reducers, w);
      add('H', `tray-riser:${t.size}`, `${kind} riser (inside / outside), ${t.size} mm`, 'no', t.risers, w);
      add('H', `tray-sup:${t.widthMm}`, `Tray support / cantilever arm, ${t.widthMm} mm`, 'no', t.supports, w);
      add('H', `tray-cpl:${t.size}`, `Coupler set (splice plates, bolts), ${t.size} mm`, 'set', t.couplers, w);
      add('H', `tray-cover:${t.widthMm}`, `Tray cover ${t.widthMm} mm`, 'm', t.coverM, w);
    }
  }

  return [...m.values()]
    .filter((x) => x.qty > 0)
    .map((x) => ({ ...x, qty: x.unit === 'm' ? Math.ceil(x.qty) : x.qty }))
    .sort((a, b) => a.section.localeCompare(b.section) || a.description.localeCompare(b.description, undefined, { numeric: true }));
}
