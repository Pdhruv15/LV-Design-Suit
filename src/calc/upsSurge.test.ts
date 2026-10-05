import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { sizeUps, UPS_DEFAULTS, type UpsSystem, type UpsSurge } from './ups';
import { buildUpsReportHtml } from '../docs/upsSolarReport';
const duty: UpsSurge = { source: 'Test <inverter> & duty', totalKw: 20, totalKva: 25, durationSeconds: 3, ratedKw: 24, ratedKva: 30, ratedSeconds: 3 };
const system = (surge?: UpsSurge): UpsSystem => ({ ...UPS_DEFAULTS, id: 'u', name: 'UPS', loads: [{ id: 'l', name: 'Running load', qty: 1, w: 10000, pf: 0.9 }], surge });
describe('inverter starting-load check', () => {
  it('applies growth once and accepts the exact power and duration boundary', () => {
    const r = sizeUps(sampleProject, system(duty));
    expect(r.surge.status).toBe('pass');
    expect(r.surge.kw).toBe(24);
    expect(r.surge.kva).toBe(30);
    expect(r.upsKva).toBe(sizeUps(sampleProject, system()).upsKva);
    expect(r.requiredAh).toBe(sizeUps(sampleProject, system()).requiredAh);
  });
  it('fails real power, apparent power and duration independently', () => {
    for (const patch of [{ ratedKw: 23 }, { ratedKva: 29 }, { ratedSeconds: 2 }]) expect(sizeUps(sampleProject, system({ ...duty, ...patch })).surge.status).toBe('fail');
  });
  it('does not infer peak capability when source or a rating is missing', () => {
    expect(sizeUps(sampleProject, system()).surge.status).toBe('not checked');
    for (const patch of [{ source: '' }, { ratedKva: undefined }, { durationSeconds: undefined }]) expect(sizeUps(sampleProject, system({ ...duty, ...patch })).surge.status).toBe('not checked');
  });
  it('rejects impossible PF, invalid numbers and scenarios that omit running loads', () => {
    for (const patch of [{ totalKw: 30 }, { ratedKw: 40 }, { totalKw: 5 }, { totalKva: 10 }, { durationSeconds: 0 }, { ratedSeconds: NaN }]) expect(sizeUps(sampleProject, system({ ...duty, ...patch })).surge.status).toBe('fail');
  });
  it('includes the entered overload duty and limits of the check in the report', () => {
    const html = buildUpsReportHtml(sampleProject, [system(duty)]);
    expect(html).toContain('Test &lt;inverter&gt; &amp; duty');
    expect(html).toContain('24 kW / 30 kVA');
    expect(html).toContain('Battery/BMS transient current and voltage dip are not verified');
  });
});
