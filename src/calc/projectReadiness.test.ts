import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from './runs';
import { buildDashboard } from './dashboard';
import { projectReadiness } from './projectReadiness';
import { UPS_DEFAULTS } from './ups';
import { PV_DEFAULTS } from './solar';
import { startChecklist } from '../help/guide';
import { sheetsByCount } from '../model/drawingSet';
const stage = (id: string, p = sampleProject, run = runCalculations(p)) => projectReadiness(p, buildDashboard(p, run), run).find(s => s.id === id)!;
describe('project readiness', () => {
  it('requires a current run even when the caller omits stale flags', () => {
    const run = runCalculations(sampleProject);
    const p = { ...sampleProject, voltageV: sampleProject.voltageV + 20 };
    expect(stage('calculate', p, run).done).toBe(false);
    expect(stage('resolve', p, run).done).toBe(false);
    expect(buildDashboard(p, run).todo.some(t => t.text.includes('out of date'))).toBe(true);
    expect(startChecklist(p, run).find(s => s.id === 'pass')!.done).toBe(false);
  });
  it('requires network earthing failures to be resolved in the existing checklist', () => {
    const run = runCalculations(sampleProject);
    const r = { ...run, results: run.results.map(x => ({ ...x, status: 'ok' as const })), earthing: run.earthing.map(x => ({ ...x, status: 'bad' as const })) };
    expect(startChecklist(sampleProject, r).find(s => s.id === 'pass')!.done).toBe(false);
  });
  it('collects UPS failures and missing checks with navigation', () => {
    const p = { ...sampleProject, upsSystems: [{ ...UPS_DEFAULTS, id: 'u', name: 'UPS-test', boardId: 'missing', chem: 'li-ion' as const, blockV: 51.2, loads: [{ id: 'l', name: 'Load', qty: 1, w: 10000 }] }] };
    const todo = buildDashboard(p).todo.filter(t => t.go?.view === 'ups');
    expect(todo.some(t => t.status === 'bad' && t.text.includes('linked UPS board'))).toBe(true);
    expect(todo.some(t => t.status === 'bad' && t.text.includes('DC bus'))).toBe(true);
    expect(todo.some(t => t.status === 'warn' && t.text.includes('BMS'))).toBe(true);
    expect(todo.some(t => t.text.includes('surge not checked'))).toBe(true);
    expect(stage('resolve', p).done).toBe(false);
  });
  it('collects solar and drawing checks and does not mark missing drawings complete', () => {
    const p = { ...sampleProject, pv: { ...PV_DEFAULTS }, drawingSet: { ...sheetsByCount(sampleProject, 10), sheets: [] } };
    const todo = buildDashboard(p).todo;
    expect(todo.some(t => t.go?.view === 'solar' && t.status === 'warn')).toBe(true);
    expect(todo.some(t => t.go?.view === 'drawings' && t.status === 'bad')).toBe(true);
    expect(stage('drawings', p).done).toBe(false);
    expect(stage('drawings').done).toBe(false);
  });
  it('keeps unknown checks pending even with no failures', () => {
    const run = runCalculations(sampleProject);
    const d = { ...buildDashboard(sampleProject, run), todo: [{ status: 'warn' as const, text: 'Manufacturer data missing' }] };
    expect(projectReadiness(sampleProject, d, run).find(s => s.id === 'resolve')!.done).toBe(false);
    expect(projectReadiness(sampleProject, { ...d, todo: [] }, run).find(s => s.id === 'resolve')!.done).toBe(true);
  });
});
