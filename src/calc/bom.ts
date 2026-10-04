import type { Board, Feeder, Project } from '../types';
import { BOARD_KINDS } from '../types';
import { cableTypeOf } from '../model/cableTypes';
import { breakerTypeOf, cpcOf } from './earthing';
import { runsOf } from './electrical';
import { sizeRiser } from './busbar';
import { sizeRoute, trayPlanOf, trayQuantities } from './cableTray';

/** Bill of materials: every item the design already knows about, rolled up
 * into tender BOQ sections. Each item has a stable key, so a price list
 * entered once prices it on every project. */

/** Design sections A–I; your own sections (J, K…) come from the project's BOQ settings. */
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
  I: 'Earthing'
};

export interface BomItem {
  key: string; // stable, e.g. "cable:XLPE/PVC/SWA:4C:95"
  section: BomSection;
  description: string;
  unit: string; // no, m, set, lot, LS
  qty: number;
  where: string[]; // boards / routes / risers it comes from
}

const kindOf = (b: Board) => b.kind ?? (b.upstreamId ? 'DB' : 'MDB');
const kindLabel = (k: string) => BOARD_KINDS.find((x) => x.value === k)?.label ?? k;
const isFinal = (f: Feeder) => !!f.phase;

/** Poles of a feeder's devices. */
export function polesOf(f: Feeder): string {
  if (f.phase && f.phase !== 'RYB') return 'SP';
  return f.cores === 2 ? 'SP+N' : f.cores === 3 ? 'TP' : 'TP+N';
}

export function breakerItem(f: Feeder): Pick<BomItem, 'key' | 'description'> {
  const t = breakerTypeOf(f);
  const p = polesOf(f);
  if (t === 'ACB') return { key: `acb:${f.breakerRatingA}:${p}:${f.breakerIcuKa}`, description: `ACB ${f.breakerRatingA} A ${p}, ${f.breakerIcuKa} kA, withdrawable, electronic trip unit` };
  if (t === 'MCCB') return { key: `mccb:${f.breakerRatingA}:${p}:${f.breakerIcuKa}`, description: `MCCB ${f.breakerRatingA} A ${p}, ${f.breakerIcuKa} kA, adjustable thermal-magnetic` };
  return { key: `mcb:${t}:${f.breakerRatingA}:${p}:${f.breakerIcuKa}`, description: `MCB ${f.breakerRatingA} A ${p}, type ${t}, ${f.breakerIcuKa} kA` };
}

/** Cable gland size by overall cable size (approximate, CW type for SWA). */
const glandSize = (csa: number, cores: number) => {
  const s = csa * cores;
  return s <= 10 ? '20S' : s <= 30 ? '20' : s <= 70 ? '25' : s <= 150 ? '32' : s <= 300 ? '40' : s <= 500 ? '50S' : s <= 750 ? '50' : s <= 1000 ? '63' : '75';
};

export function buildBom(project: Pick<Project, 'boards' | 'feeders'> & Partial<Project>): BomItem[] {
  const p = project as Project;
  const m = new Map<string, BomItem>();
  const add = (section: BomSection, key: string, description: string, unit: BomItem['unit'], qty: number, where: string) => {
    if (!(qty > 0)) return;
    const it = m.get(key) ?? { key, section, description, unit, qty: 0, where: [] };
    it.qty += qty;
    if (where && !it.where.includes(where)) it.where.push(where);
    m.set(key, it);
  };

  // Panels, incomers and board-mounted equipment
  for (const b of p.boards) {
    const k = kindOf(b);
    const rating = b.ratedCurrentA ?? p.feeders.find((f) => f.feedsBoardId === b.id)?.breakerRatingA;
    const bus = b.busbarMaterial === 'aluminium' ? 'Al' : 'Cu';
    const enc = b.enclosure;
    const encText = enc ? `, enclosure ${enc.range} ${enc.config.ref}${enc.dims ? ` (H${enc.dims.h} × W${enc.dims.w} × D${enc.dims.d} mm)` : ''}` : '';
    add('A', `panel:${k}:${rating ?? '-'}:${b.ipRating ?? '-'}${enc ? `:${enc.catalogueId}:${enc.config.id}` : ''}`,
      `${kindLabel(k)} (${k})${rating ? `, ${rating} A` : ''}, ${bus} busbar${b.ipRating ? `, ${b.ipRating}` : ''}${encText}, form of separation to spec.`, 'no', 1, b.id);
    // Extra the supplier's chart adds for the enclosure case (e.g. an 800 mm busbar).
    if (enc?.extra) add('A', `enc-extra:${enc.extra}`, enc.extra.replace(/ to add in the estimate$/, '').replace(/^./, (c) => c.toUpperCase()) + ' for the distribution board (supplier chart allowance)', 'no', 1, b.id);
    // Incomer device of a board fed from a transformer or the authority
    if (!b.upstreamId && rating) {
      const dev = b.supply?.device ?? (rating > 630 ? 'ACB' : 'MCCB');
      add('B', `incomer:${dev}:${rating}`, `Incomer ${dev} ${rating} A 4P${dev === 'ACB' ? ', withdrawable, electronic trip unit' : ''}`, 'no', 1, b.id);
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
      add('I', `earth-pit:${el}`, `Earth pit: ${el} m copper-bonded earth electrode with inspection pit and cover, tested`, 'no', b.earthing?.pits ?? 2, b.id);
      const inc = p.feeders.find((f) => f.feedsBoardId === b.id);
      const mm = b.earthing?.conductorMm2 ?? (inc ? Math.max(16, cpcOf(inc)) : 50);
      add('I', `met:${mm}`, `Main earth terminal bar with test link; earth conductor 1C × ${mm} mm² Cu/PVC to the pits (length to site)`, 'set', 1, b.id);
    }
    if (b.sourceKva) add('D', `tx:${b.sourceKva}:${b.sourceImpedancePct ?? '-'}`, `Distribution transformer ${b.sourceKva} kVA, 11/0.415 kV, ${b.vectorGroup ?? 'Dyn11'}${b.sourceImpedancePct ? `, Z ${b.sourceImpedancePct} %` : ''}`, 'no', 1, b.id);
    if (k === 'UPS' && b.upsKva) add('D', `ups:${b.upsKva}`, `UPS ${b.upsKva} kVA online double conversion, with batteries`, 'no', 1, b.id);
  }

  // Outgoing ways: breakers, earth leakage, meters, isolators, equipment
  for (const f of p.feeders) {
    const bi = breakerItem(f);
    add('B', bi.key, bi.description, 'no', 1, f.boardId);
    const poles = polesOf(f);
    if (f.rcdMa) add('B', `rcd:${f.rcdMa}:${poles}:${f.breakerRatingA}`, `Earth leakage protection ${f.rcdMa} mA, ${poles}, ${f.breakerRatingA} A`, 'no', 1, f.boardId);
    if (f.kwhMeter) add('C', `kwh:${f.kwhMeter}`, f.kwhMeter === 'CT' ? 'kWh meter, CT operated, with CTs and test block' : `kWh meter, direct ${f.kwhMeter === '1-PH' ? '1-phase' : '3-phase'}`, 'no', 1, f.boardId);
    if (f.localIsolator) add('B', `iso:${f.breakerRatingA}:${poles}`, `Local isolator ${f.breakerRatingA} A ${poles}, weatherproof enclosure`, 'no', 1, f.boardId);
    if (f.kvar) add('D', `cap:${f.kvar}:${f.capSteps ?? 1}:${f.detunedPct ?? 0}`, `${f.capSteps ? 'Capacitor bank' : 'Fixed capacitor'} ${f.kvar} kvar${f.capSteps && f.capSteps > 1 ? `, ${f.capSteps} steps` : ''}${f.detunedPct ? `, ${f.detunedPct} % detuned` : ''}${f.capSteps ? ', with APFC relay' : ''}`, 'no', 1, f.boardId);

    // Cable and its earth conductor
    const runs = runsOf(f);
    const len = f.lengthM * runs;
    const t = cableTypeOf(p, f);
    if (isFinal(f)) {
      add('E', `wire:${f.cableCsaMm2}`, `Single-core wiring ${f.cableCsaMm2} mm² Cu/PVC in conduit (per circuit: ${f.cores} conductors + CPC)`, 'm', len, f.boardId);
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
