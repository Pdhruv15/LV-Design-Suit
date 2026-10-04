import { afterEach, describe, expect, it } from 'vitest';
import { buildBom, type BomItem } from '../calc/bom';
import { EMPTY_CATALOG, setCatalog } from '../database/catalog';
import { sampleProject } from '../data/sampleProject';
import { boqReview, scopeSummary } from './boqScope';
import { EXTRAS, fallbackPriceEntry, fallbackRate, newPriceList, priceBom, pricingBasis, type BoqCustom, type PriceEntry } from './priceList';

const item = (key = 'fixture'): BomItem => ({ key, section: 'J', description: 'Luminaire', unit: 'no', qty: 3, where: ['DB-01'], quantitySource: 'Load schedule point counts' });
const priced = (scope: BoqCustom['overrides'] = {}, quote: PriceEntry = { rate: 100, labour: 20 }) => priceBom([item()], { ...newPriceList(), rates: { fixture: quote } }, { overrides: scope });
const project = (custom: BoqCustom = {}) => ({ ...sampleProject, boq: custom });
afterEach(() => setCatalog(EMPTY_CATALOG));

describe('selected switching device consistency', () => {
  it('requires reconciliation with the calculation input without silently changing that input', () => {
    const feeder = { ...sampleProject.feeders[0], device: 'ACB' as const, breakerType: 'MCCB' as const };
    const p = { ...sampleProject, feeders: [feeder] };
    expect(boqReview(p, priceBom([])).find((x) => x.id === `device-mismatch:${feeder.id}`)?.message).toContain('BOQ uses the selected device');
    expect(p.feeders[0].breakerType).toBe('MCCB');
  });
});

describe('contractor BOQ pricing responsibilities', () => {
  it('preserves default supply + installation and legacy rate-only lumped quotes', () => {
    const split = priced().items[0];
    expect(split).toMatchObject({ action: 'new', supplyBy: 'contractor', installBy: 'contractor', amount: 360, missingRate: false });
    const lumped = priced({}, { rate: 100 }).items[0];
    expect(lumped).toMatchObject({ amount: 300, installRateMissing: false, missingRate: false });
  });
  it('retains contractor installation for client-supplied and by-others supplied products', () => {
    for (const supplyBy of ['client', 'others'] as const) {
      const row = priced({ fixture: { supplyBy } }).items[0];
      expect(row).toMatchObject({ amount: 60, supplyCharge: false, installCharge: true, source: 'list', missingRate: false });
    }
    expect(scopeSummary(priced({ fixture: { supplyBy: 'client' } }).items[0])).toContain('supply: client');
  });
  it('charges new supply only when installation belongs to someone else', () => {
    const row = priced({ fixture: { installBy: 'others' } }).items[0];
    expect(row).toMatchObject({ amount: 300, supplyCharge: true, installCharge: false, missingRate: false });
  });
  it('retains for zero cost; relocate/remove cost installation only; replace costs both', () => {
    expect(priced({ fixture: { action: 'retain' } }).items[0]).toMatchObject({ amount: 0, source: 'excluded', missingRate: false });
    for (const action of ['relocate', 'remove'] as const) expect(priced({ fixture: { action } }).items[0]).toMatchObject({ amount: 60, supplyCharge: false, installCharge: true });
    expect(priced({ fixture: { action: 'replace' } }).items[0].amount).toBe(360);
  });
  it('requires an explicit installation-only quote and recognises an explicit zero', () => {
    for (const scope of [{ supplyBy: 'client' as const }, { action: 'relocate' as const }, { action: 'remove' as const }]) {
      const missing = priced({ fixture: scope }, { rate: 100 }).items[0];
      expect(missing).toMatchObject({ amount: 0, supplyRateMissing: false, installRateMissing: true, missingRate: true, source: 'missing' });
      const zero = priced({ fixture: scope }, { labour: 0 }).items[0];
      expect(zero).toMatchObject({ amount: 0, missingRate: false, installRateMissing: false, source: 'list' });
    }
  });
  it('keeps known installation charges when contractor supply is unquoted', () => {
    const bom = priced({}, { labour: 20 });
    expect(bom.items[0]).toMatchObject({ amount: 60, supplyRateMissing: true, installRateMissing: false, missingRate: true });
    expect(bom.missing).toBe(1);
    expect(pricingBasis(bom).lines.join(' ')).toContain('known charges remain included');
  });
  it('supports installation-only manual lines with quoted zero', () => {
    const bom = priceBom([], undefined, { manual: [{ id: 'a', section: 'N', description: 'Relocate', unit: 'no', qty: 2, action: 'relocate', labour: 0 }] });
    expect(bom.items[0]).toMatchObject({ source: 'manual', amount: 0, missingRate: false });
    expect(pricingBasis(bom).manual).toBe(1);
  });
  it('preserves legacy excluded overrides', () => {
    expect(priced({ fixture: { excluded: true } }).items[0]).toMatchObject({ source: 'excluded', amount: 0, supplyBy: 'others', installBy: 'others', missingRate: false });
  });
  it('keeps fallback catalogue supply and installation separate without double counting', () => {
    setCatalog({ ...EMPTY_CATALOG, equipment: [{ category: 'lighting', description: 'Luminaire', boqKey: 'fixture', price: 100, install: 20 }] });
    expect(fallbackRate('fixture')).toBe(120);
    expect(fallbackPriceEntry('fixture')).toEqual({ rate: 100, labour: 20 });
    const bom = priceBom([item()], undefined, { overrides: { fixture: { supplyBy: 'client' } } });
    expect(bom.items[0]).toMatchObject({ rate: 100, labour: 20, amount: 60, source: 'typical' });
    expect(priceBom([item()]).items[0].amount).toBe(360);
  });
});

describe('explicit priced packages', () => {
  const assembly = (overrides: BoqCustom['overrides'], rates: Record<string, PriceEntry> = { panel: { rate: 1000 }, breaker: { rate: 100 }, lug: { rate: 20 } }) =>
    priceBom(['panel', 'breaker', 'lug'].map((k) => ({ ...item(k), qty: 1 })), { ...newPriceList(), rates }, { overrides });
  it('suppresses components only when a valid package is already priced', () => {
    const bom = assembly({ breaker: { includedIn: 'panel' }, lug: { includedIn: 'panel' } });
    expect(bom.total).toBe(1000);
    expect(bom.items[1]).toMatchObject({ amount: 0, source: 'excluded', missingRate: false });
    expect(bom.items[1].note).toContain('Included in package');
  });
  it('supports package chains independent of item order', () => {
    const bom = assembly({ breaker: { includedIn: 'panel' }, lug: { includedIn: 'breaker' } });
    expect(bom.total).toBe(1000);
    expect(boqReview(project(), bom).some((x) => x.id.startsWith('package:'))).toBe(false);
  });
  it.each<NonNullable<BoqCustom['overrides']>>([
    { breaker: { includedIn: 'breaker' } },
    { breaker: { includedIn: 'absent' } },
    { breaker: { includedIn: 'lug' }, lug: { includedIn: 'breaker' } }
  ])('does not suppress dangling, self or cyclic links: %j', (overrides) => {
    const bom = assembly(overrides);
    expect(bom.total).toBe(1120);
    expect(boqReview(project(), bom).some((x) => x.id === 'package:breaker')).toBe(true);
  });
  it('does not suppress against retained, unquoted or free packages', () => {
    for (const bom of [
      assembly({ panel: { action: 'retain' }, breaker: { includedIn: 'panel' } }),
      assembly({ breaker: { includedIn: 'panel' } }, { breaker: { rate: 100 }, lug: { rate: 20 } }),
      assembly({ breaker: { includedIn: 'panel' } }, { panel: { rate: 0 }, breaker: { rate: 100 }, lug: { rate: 20 } })
    ]) {
      expect(bom.items[1].amount).toBe(100);
      expect(boqReview(project(), bom).some((x) => x.id === 'package:breaker')).toBe(true);
    }
  });
  it('allows package pricing to cover an otherwise unquoted component', () => {
    const bom = assembly({ breaker: { includedIn: 'panel' } }, { panel: { rate: 1000 }, lug: { rate: 20 } });
    expect(bom.items[1]).toMatchObject({ source: 'excluded', missingRate: false });
    expect(bom.missing).toBe(0);
  });
  it('does not let installation-only packages hide contractor-supplied components', () => {
    for (const parentScope of [{ supplyBy: 'client' as const }, { supplyBy: 'others' as const }, { action: 'remove' as const }, { installBy: 'others' as const }]) {
      const bom = assembly({ panel: parentScope, breaker: { includedIn: 'panel' } }, { panel: { rate: 1000, labour: 100 }, breaker: { rate: 100, labour: 10 }, lug: { rate: 20 } });
      expect(bom.items[1].amount).toBe(110);
      expect(boqReview(project(), bom).find((x) => x.id === 'package:breaker')?.message).toContain('responsibilities');
    }
  });
  it('rejects different work actions even when both are installation-only', () => {
    const bom = assembly({ panel: { action: 'remove' }, breaker: { action: 'relocate', includedIn: 'panel' } }, { panel: { labour: 100 }, breaker: { labour: 10 }, lug: { rate: 20 } });
    expect(bom.items[1].amount).toBe(10);
    expect(boqReview(project(), bom).find((x) => x.id === 'package:breaker')?.message).toContain('different work action');
  });
  it('accepts consistent installation-only packages and replacement assemblies', () => {
    const relocation = assembly({ panel: { action: 'relocate' }, breaker: { action: 'relocate', includedIn: 'panel' } }, { panel: { labour: 100 }, breaker: { labour: 10 }, lug: { rate: 20 } });
    expect(relocation.items[1]).toMatchObject({ amount: 0, source: 'excluded' });
    const replacement = assembly({ panel: { action: 'replace' }, breaker: { includedIn: 'panel' } });
    expect(replacement.items[1]).toMatchObject({ amount: 0, source: 'excluded' });
  });
});

describe('contractor scope review', () => {
  it('templates do not create quantities and included scope requires measured items', () => {
    const custom: BoqCustom = { projectType: 'fit-out', scopeReview: { lighting: 'included', elv: 'by-others', plant: 'not-applicable' } };
    const empty = priceBom([], undefined, custom);
    expect(empty.items).toEqual([]);
    const review = boqReview(project(custom), empty);
    expect(review.some((x) => x.id === 'scope-quantity:lighting')).toBe(true);
    expect(review.some((x) => x.id === 'scope:elv' || x.id === 'scope:plant')).toBe(false);
  });
  it('does not burden legacy manual lines with mandatory evidence but reviews new templates', () => {
    const manual = [{ id: 'a', section: 'J', description: 'Luminaire', unit: 'no', qty: 3, rate: 100 }];
    expect(boqReview(project({ manual }), priceBom([], undefined, { manual })).some((x) => x.id.startsWith('manual-evidence:'))).toBe(false);
    const custom: BoqCustom = { manual, projectType: 'new-installation' };
    expect(boqReview(project(custom), priceBom([], undefined, custom)).some((x) => x.id === 'manual-evidence:manual:a')).toBe(true);
  });
  it('flags selected but unmeasured extras rather than inventing quantities', () => {
    const countExtras = EXTRAS.filter((x) => x.unit === 'no' || x.unit === 'm' || x.unit === 'm²');
    expect(countExtras.every((x) => x.qty === 0)).toBe(true);
    const m = { ...countExtras[0], id: 'pending', rate: 100 };
    const custom = { manual: [m] };
    expect(boqReview(project(custom), priceBom([], undefined, custom)).some((x) => x.id === 'quantity:manual:pending')).toBe(true);
  });
  it('does not create credits from invalid quantities, rates, wastage or discounts', () => {
    const custom: BoqCustom = { overrides: { fixture: { qty: -2 } }, wastage: { J: -10 }, discountPct: 200 };
    const bom = priceBom([item()], { ...newPriceList(), markupPct: -10, rates: { fixture: { rate: -100, labour: -20 } } }, custom);
    expect(bom.items[0].qty).toBe(-2);
    expect(bom.total).toBe(0);
    const review = boqReview({ ...project(custom), priceList: { ...newPriceList(), markupPct: -10 } }, bom);
    expect(review.map((x) => x.id)).toEqual(expect.arrayContaining(['quantity:fixture', 'invalid-rate:fixture', 'wastage:J', 'discount', 'markup']));
  });
  it('preserves quantity source and evidence with a design override', () => {
    const row = priced({ fixture: { qty: 4, evidence: 'Lighting layout revision B' } }).items[0];
    expect(row.quantitySource).toContain('BOQ quantity override');
    expect(scopeSummary(row)).toContain('Lighting layout revision B');
  });
  it('does not infer measured conduit quantities from conductor descriptions', () => {
    const custom: BoqCustom = { projectType: 'new-installation', scopeReview: { 'conduit-boxes': 'included' } };
    const wire: BomItem = { ...item('wire-conductor:2.5'), section: 'E', description: 'Single-core wiring (conductor metres; conduit measured separately)' };
    const bom = priceBom([wire], undefined, custom);
    expect(boqReview(project(custom), bom).some((x) => x.id === 'scope-quantity:conduit-boxes')).toBe(true);
  });
  it('recognises selected lighting products by point type rather than product name', () => {
    const custom: BoqCustom = { projectType: 'new-installation', scopeReview: { lighting: 'included' } };
    const lamp = { ...item('point:ltg:Downlight%2012%20W'), description: 'Downlight 12 W — load schedule point count' };
    expect(boqReview(project(custom), priceBom([lamp], undefined, custom)).some((x) => x.id === 'scope-quantity:lighting')).toBe(false);
  });
  it('does not use tested earth pits as coverage of system testing and commissioning', () => {
    const custom: BoqCustom = { scopeReview: { testing: 'included' } };
    const pit = { ...item('earth-pit:3'), section: 'I', description: 'Earth electrode with inspection pit and cover, tested' };
    expect(boqReview(project(custom), priceBom([pit], undefined, custom)).some((x) => x.id === 'scope-quantity:testing')).toBe(true);
  });
  it.each([
    { phase: undefined, way: 1, reason: 'missing phase' },
    { phase: 'R' as const, way: undefined, reason: 'missing way number' },
    { phase: undefined, way: undefined, reason: 'missing phase, missing way number' }
  ])('reports omitted positive point counts even when other valid schedule points exist: %j', ({ phase, way, reason }) => {
    const custom: BoqCustom = { includeSchedulePoints: true };
    const feeder = { ...sampleProject.feeders[0], boardId: sampleProject.boards[0].id, points: { ltg: 2 } };
    const p = { ...project(custom), feeders: [
      { ...feeder, id: 'valid', name: 'Valid lighting', phase: 'R' as const, way: 1 },
      { ...feeder, id: 'omitted', name: 'Unassigned lighting', phase, way }
    ] };
    const bom = priceBom(buildBom(p), undefined, custom);
    expect(bom.items.find((x) => x.key.startsWith('point:ltg:'))?.qty).toBe(2);
    const review = boqReview(p, bom);
    expect(review.find((x) => x.id === 'schedule-omitted:omitted')?.message).toContain(reason);
    expect(review.some((x) => x.id === 'schedule-omitted:valid')).toBe(false);
    expect(review.some((x) => x.id === 'schedule-points')).toBe(false);
  });
  it('does not add omitted-point warnings when point take-off is disabled', () => {
    const p = { ...project(), feeders: [{ ...sampleProject.feeders[0], phase: undefined, way: undefined, points: { ltg: 3 } }] };
    expect(boqReview(p, priceBom(buildBom(p))).some((x) => x.id.startsWith('schedule-omitted:'))).toBe(false);
  });
});

describe('saved BOQ key migration review', () => {
  const rawPanel = (key: string): BomItem => ({ key, section: 'A', description: 'Distribution board', unit: 'no', qty: 1, where: ['DB-1'] });
  it('warns orphan saved scope/quantity/exclusion overrides without applying them to a new key', () => {
    const old = 'panel:DB:100:IP42';
    const current = 'panel:DB:100:IP42:Cu:-:-';
    const custom: BoqCustom = { overrides: { [old]: { excluded: true, qty: 99, supplyBy: 'client', evidence: 'Existing supplier quote' } } };
    const list = { ...newPriceList(), rates: { [current]: { rate: 100 } } };
    const p = { ...project(custom), priceList: list };
    const bom = priceBom([rawPanel(current)], list, custom);
    expect(bom.items[0]).toMatchObject({ qty: 1, supplyBy: 'contractor', amount: 100 });
    expect(boqReview(p, bom).find((x) => x.id === `orphan-override:${old}`)?.message).toContain(old);
  });
  it('distinguishes disabled point overrides from missing specification keys', () => {
    const key = 'point:ltg:Downlight';
    const custom: BoqCustom = { includeSchedulePoints: false, overrides: { [key]: { qty: 7 } } };
    expect(boqReview(project(custom), priceBom([], undefined, custom)).find((x) => x.id === `orphan-override:${key}`)?.message).toContain('inactive');
  });
  it('requires a new conductor-metre quote and ignores unrelated old wire rates', () => {
    const list = { ...newPriceList(), rates: { 'wire:2.5': { rate: 10 }, 'wire:1.5': { rate: 7 } } };
    const p = { ...project(), priceList: list };
    const raw = { ...item('wire-conductor:2.5'), section: 'E', unit: 'm', qty: 30 };
    const bom = priceBom([raw], list);
    expect(bom.items[0]).toMatchObject({ source: 'missing', amount: 0 });
    const review = boqReview(p, bom);
    expect(review.find((x) => x.id === 'legacy-wire-rate:wire:2.5')?.message).toContain('conductor metres');
    expect(review.some((x) => x.id === 'legacy-wire-rate:wire:1.5')).toBe(false);
  });
  it('warns matching legacy panel quotes, including enclosure keys, without copying rates', () => {
    for (const enclosure of ['', ':supplier-range:config-1', ':supplier-range:config-1:flush:925x465x115:2']) {
      const old = `panel:DB:100:IP42${enclosure.split(':').slice(0, 3).join(':')}`;
      const current = `panel:DB:100:IP42:Cu:Make:Model${enclosure}`;
      const list = { ...newPriceList(), rates: { [old]: { rate: 100 }, 'panel:MDB:1600:IP54': { rate: 5000 } } };
      const p = { ...project(), priceList: list };
      const bom = priceBom([rawPanel(current)], list);
      expect(bom.items[0].amount).toBe(0);
      const review = boqReview(p, bom);
      expect(review.find((x) => x.id === `legacy-panel-rate:${old}`)?.message).toContain(current);
      expect(review.some((x) => x.id === 'legacy-panel-rate:panel:MDB:1600:IP54')).toBe(false);
    }
  });
});
