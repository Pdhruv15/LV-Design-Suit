import { describe, expect, it } from 'vitest';
import { newProject } from '../types';
import { newBrief } from './brief';
import { applyBrief } from './brief';
import { applyTemplateSystem, briefFromTemplate, templateFrom, templateOverrides } from './setupTemplate';

const source = () => {
  const b = newBrief('consultant', { company: 'ABC Eng' });
  b.parties[0].name = 'Old Owner'; b.deliverables[0] = { ...b.deliverables[0], done: true, targetDate: '2026-01-01' };
  return { ...applyBrief(newProject('Old job'), b), voltageV: 400, ambientC: 50 };
};

describe('setup template', () => {
  it('carries setup only: no parties, dates, ticks or project identity', () => {
    const t = templateFrom(source(), 'Villa DEWA');
    const json = JSON.stringify(t);
    expect(json).not.toContain('Old Owner');
    expect(json).not.toContain('Old job');
    expect(json).not.toContain('2026-01-01');
    expect(t.deliverables.every((d) => !('done' in d) && !('targetDate' in d))).toBe(true);
    expect(t.system.voltageV).toBe(400);
  });
  it('starts a project with only your own company as a party', () => {
    const b = briefFromTemplate(templateFrom(source(), 'T'), 'My Co');
    expect(b.parties.filter((p) => p.name).map((p) => p.name).sort()).toEqual(['DEWA', 'My Co']);
    expect(b.deliverables.every((d) => !d.done && !d.targetDate)).toBe(true);
  });
  it('applies system defaults over the base and lists what it overrides', () => {
    const t = templateFrom(source(), 'T');
    const base = newProject('New');
    const p = applyTemplateSystem(base, t);
    expect(p.voltageV).toBe(400); expect(p.ambientC).toBe(50); expect(p.name).toBe('New');
    expect(templateOverrides(base, t).some((o) => o.label.includes('Ambient'))).toBe(true);
  });
  it('is independent of the template afterwards', () => {
    const t = templateFrom(source(), 'T');
    const p = applyTemplateSystem(newProject('N'), t);
    t.system.voltageV = 1;
    expect(p.voltageV).toBe(400);
  });
});
