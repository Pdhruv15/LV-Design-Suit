import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { engineRequest } from '../../src/engines/external';
import type { EngineProbe, StudyResults } from '../../src/engines/types';
import { getCable } from '../../src/calc/cableTable';
import { resistanceFactor } from '../../src/calc/electrical';
import type { Project } from '../../src/types';
import { referenceNetworks } from './referenceNetworks';

/** The external engines (engines/python/lvds_engine.py) run on the reference networks:
 * - golden results: every value must match tests/engines/golden/<engine>.json, made with the versions
 *   pinned in engines/python/requirements.txt. After an intended change, regenerate them with
 *   `UPDATE_GOLDEN=1 npx vitest run tests/engines` and review the diff;
 * - hand calculation and engine-to-engine agreement, so the golden values are known to be right;
 * - the error messages the app shows when a study cannot run.
 * Skipped when Python or an engine is missing, except with LVDS_ENGINES=required (CI). */

const SCRIPT = 'engines/python/lvds_engine.py';
const GOLDEN = 'tests/engines/golden';
const ENGINES = ['opendss', 'pandapower'] as const;
type EngineId = (typeof ENGINES)[number];
const required = process.env.LVDS_ENGINES === 'required';
const update = !!process.env.UPDATE_GOLDEN;
const python = process.env.LVDS_PYTHON ?? ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);
const probe: EngineProbe | null = python ? JSON.parse(spawnSync(python, [SCRIPT], { input: '{"engine":"probe"}', encoding: 'utf8' }).stdout) : null;
const has = (id: EngineId) => !!probe?.engines[id]?.available;

function call(request: object, args: string[] = []): Promise<StudyResults | { error: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(python!, [...args, SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`Not JSON on stdout: ${out.slice(0, 200)} ${err.slice(-400)}`));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
const study = async (engine: EngineId, project: Project) => {
  const res = await call(engineRequest(engine, project));
  if ('error' in res) throw new Error(`${engine} on ${project.name}: ${res.error}`);
  return res;
};
const errorOf = async (engine: EngineId, project: Project, args: string[] = []) => {
  const res = await call(engineRequest(engine, project), args);
  return 'error' in res ? res.error : '(no error)';
};

/** Golden form: values to 6 significant figures, without the line naming the engine version. */
const VERSION_LINE = /^(OpenDSS DSS C-API|pandapower \d)/;
const sig = (n: number) => Number(n.toPrecision(6));
const roundAll = (o: Record<string, Record<string, number>> = {}) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([q, n]) => [q, sig(n)]))]));
const golden = (r: StudyResults) => ({ feeders: roundAll(r.feeders as never), boards: roundAll(r.boards as never), messages: r.messages.filter((m) => !VERSION_LINE.test(m)) });

describe('external engines on the reference networks', () => {
  if (required) {
    it('Python and both engines are installed (LVDS_ENGINES=required)', () => {
      expect(python, 'no python3 / python on PATH').toBeTruthy();
      for (const id of ENGINES) expect(probe?.engines[id], `${id} not installed: pip install -r engines/python/requirements.txt`).toMatchObject({ available: true });
    });
  }

  const results: Partial<Record<EngineId, Record<string, StudyResults>>> = {};
  beforeAll(async () => {
    await Promise.all(ENGINES.filter(has).map(async (id) => {
      const entries = await Promise.all(Object.entries(referenceNetworks).map(async ([name, p]) => [name, await study(id, p)] as const));
      results[id] = Object.fromEntries(entries);
    }));
  }, 120_000);

  for (const id of ENGINES) {
    describe.skipIf(!has(id))(`${id} golden results`, () => {
      const file = join(GOLDEN, `${id}.json`);
      const info = probe?.engines[id];
      const sameVersion = !info?.tested || info.version === info.tested;

      it.skipIf(!sameVersion && !required)(`match ${file} (made with ${id} ${info?.tested ?? '?'})`, () => {
        expect(info?.version, `installed ${id} differs from the pinned version`).toBe(info?.tested);
        const now = Object.fromEntries(Object.entries(results[id]!).map(([n, r]) => [n, golden(r)]));
        if (update) {
          mkdirSync(GOLDEN, { recursive: true });
          writeFileSync(file, JSON.stringify({ engine: id, version: info?.version, networks: now }, null, 2) + '\n');
          return;
        }
        expect(existsSync(file), `${file} missing: run with UPDATE_GOLDEN=1`).toBe(true);
        const want = JSON.parse(readFileSync(file, 'utf8')).networks as typeof now;
        expect(Object.keys(now).sort()).toEqual(Object.keys(want).sort());
        for (const [net, w] of Object.entries(want)) {
          const got = now[net];
          expect(got.messages, `${net} messages`).toEqual(w.messages);
          for (const part of ['feeders', 'boards'] as const) {
            expect(Object.keys(got[part]).sort(), `${net} ${part}`).toEqual(Object.keys(w[part]).sort());
            for (const [el, values] of Object.entries(w[part])) {
              expect(Object.keys(got[part][el]).sort(), `${net} ${el}`).toEqual(Object.keys(values).sort());
              for (const [q, v] of Object.entries(values)) {
                const g = got[part][el][q];
                expect(Math.abs(g - v), `${net} ${el} ${q}: ${g} vs golden ${v}`).toBeLessThanOrEqual(1e-4 * Math.max(1, Math.abs(v)));
              }
            }
          }
        }
      });
    });
  }

  // 1000 kVA, 5 % (X/R 5) at 400 V from a stiff source: Ik = S / (√3 · U · z) = 28.87 kA.
  const S = 1000e3, U = 400, z = 0.05, xr = 5;
  const ikTx = S / (Math.sqrt(3) * U * z) / 1000;
  const within = (got: number | undefined, want: number, pct: number) => {
    expect(got).toBeDefined();
    expect(Math.abs(got! / want - 1) * 100, `${got} vs hand ${want.toFixed(3)}`).toBeLessThanOrEqual(pct);
  };
  const handLoad = () => {
    const ib = 100e3 / (Math.sqrt(3) * U * 0.9);
    const c = getCable(95);
    const r = c.rOhmPerKm20C * resistanceFactor(undefined);
    const vd = (Math.sqrt(3) * ib * 0.05 * (r * 0.9 + c.xOhmPerKm * Math.sin(Math.acos(0.9)))) / U * 100;
    return { ib, vd };
  };

  it.skipIf(!has('opendss'))('OpenDSS agrees with hand calculation (c = 1)', () => {
    const r = results.opendss!['single-transformer'];
    within(r.boards!.MDB.faultKA, ikTx, 0.5);
    within(r.feeders.L1.ib, handLoad().ib, 3); // constant power: slightly above nominal-voltage current
    within(r.feeders.L1.vdTotalPct, handLoad().vd, 3);
  });

  it.skipIf(!has('pandapower'))('pandapower agrees with hand calculation (IEC 60909: cmax 1.10, KT)', () => {
    const xt = (z * xr) / Math.sqrt(1 + xr * xr);
    const kt = (0.95 * 1.1) / (1 + 0.6 * xt);
    const r = results.pandapower!['single-transformer'];
    within(r.boards!.MDB.faultKA, (1.1 * ikTx) / kt, 0.5);
    within(r.feeders.L1.ib, handLoad().ib, 3);
    within(r.feeders.L1.vdTotalPct, handLoad().vd, 3);
  });

  it.skipIf(!has('opendss') || !has('pandapower'))('OpenDSS and pandapower agree on balanced load flow', () => {
    for (const net of ['single-transformer', 'three-level', 'pv-generation', 'two-transformers']) {
      const a = results.opendss![net], b = results.pandapower![net];
      for (const [id, fb] of Object.entries(b.feeders)) {
        const fa = a.feeders[id];
        expect(Math.abs(fa.ib! - fb.ib!), `${net} ${id} Ib ${fa.ib} vs ${fb.ib}`).toBeLessThanOrEqual(0.01 * Math.max(fb.ib!, 1));
        expect(Math.abs(fa.vdTotalPct! - fb.vdTotalPct!), `${net} ${id} VD`).toBeLessThanOrEqual(0.05);
      }
      for (const [id, bb] of Object.entries(b.boards!)) {
        expect(Math.abs(a.boards![id].voltagePct! - bb.voltagePct!), `${net} ${id} busbar V`).toBeLessThanOrEqual(0.1);
      }
    }
  });
});

describe.skipIf(!python)('external engine error messages', () => {
  const net = referenceNetworks['three-level'];
  const overloaded: Project = { ...net, feeders: net.feeders.map((f) => (f.id === 'MDB-CH' ? { ...f, loadKw: 40000 } : f)) };

  it('rejects networks that cannot be studied, naming every problem', async () => {
    const noSource = { ...net, boards: net.boards.map((b) => ({ ...b, sourceKva: undefined })) };
    expect(await errorOf('pandapower', noSource)).toContain('No main board has transformer data');
    const loop = { ...net, boards: net.boards.map((b) => (b.id === 'MDB' ? { ...b, upstreamId: 'DB' } : b)) };
    expect(await errorOf('pandapower', loop)).toMatch(/loop of upstream boards/);
    const bad = { ...net, feeders: net.feeders.map((f) => (f.id === 'DB-LTG' ? { ...f, lengthM: 0 } : f.id === 'DB-PWR' ? { ...f, powerFactor: 1.4 } : f)) };
    const msg = await errorOf('opendss', bad);
    expect(msg).toContain('Feeder DB-LTG has a cable length of 0 m');
    expect(msg).toContain('Feeder DB-PWR has a power factor of 1.4');
  });

  it('says how to install an engine that is missing', async () => {
    // -S skips site-packages, so neither engine package can be imported.
    expect(await errorOf('pandapower', net, ['-S'])).toMatch(/pandapower is not installed .* pip install -r ".*requirements\.txt"/);
    expect(await errorOf('opendss', net, ['-S'])).toMatch(/opendssdirect\.py is not installed/);
  });

  const cause = /main board MDB has \d+ kVA of demand on a 1600 kVA transformer/;
  it.skipIf(!has('pandapower'))('pandapower: a load flow that does not converge names the likely cause', async () => {
    const msg = await errorOf('pandapower', overloaded);
    expect(msg).toMatch(/pandapower load flow did not converge after 100 iterations/);
    expect(msg).toMatch(cause);
  }, 60_000);

  it.skipIf(!has('opendss'))('OpenDSS: loads below 95 % voltage are flagged, with the likely cause', async () => {
    const res = await study('opendss', overloaded);
    const note = res.messages.find((m) => m.startsWith('Load voltage is below 95 %'));
    expect(note).toMatch(/MDB-CH/);
    expect(note).toMatch(cause);
  }, 60_000);
});
