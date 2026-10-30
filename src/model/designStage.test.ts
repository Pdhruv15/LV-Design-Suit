import { describe, expect, it } from 'vitest';
import { newProject, type Project } from '../types';
import { advanceStage, ifcIssued, nextStage, setTenderRoute, splitByStage, stageOf, stagesOf, stageStatusesListed, stepBackStage } from './designStage';
import { baselineOf } from './designBaseline';
import { changedSinceRevision } from './revisions';
import { tabForStage, tabForView, viewForTab } from '../components/Ribbon';
import { stageChecklist } from '../calc/projectReadiness';
import { buildDashboard } from '../calc/dashboard';
import { newComment, withComment, openTenderQueries } from './reviewComments';

const withSheets = (p: Project): Project => ({ ...p, drawingSet: { sheets: [{ id: 's1', number: 'E-01', title: 'SLD', kind: 'sld', boards: [], size: 'auto', status: 'PRELIMINARY' }, { id: 's2', number: 'E-02', title: 'As built', kind: 'sld', boards: [], size: 'auto', status: 'AS-BUILT' }] } as unknown as Project['drawingSet'] });

describe('design stages', () => {
  it('starts new projects at concept; older projects carry on as detailed design', () => {
    expect(stageOf(newProject('A'))).toBe('concept');
    expect(stageOf({ ...newProject('B'), stage: undefined })).toBe('detailed');
  });

  it('has a tender stage only on the tender-before-IFC route', () => {
    const p = newProject('A');
    expect(stagesOf(p)).toEqual(['concept', 'schematic', 'detailed', 'ifc']);
    expect(stagesOf(setTenderRoute(p, 'before-ifc'))).toEqual(['concept', 'schematic', 'detailed', 'tender', 'ifc']);
    const atTender = setTenderRoute({ ...p, stage: { current: 'tender', route: 'before-ifc' } }, 'from-ifc');
    expect(stageOf(atTender)).toBe('ifc');
  });

  it('the gate issues a revision, makes it the baseline and moves on with the next drawing status', () => {
    const p = withSheets(newProject('A'));
    const q = advanceStage(p, { by: 'PG', date: '2026-10-20' });
    expect(stageOf(q)).toBe('schematic');
    expect(q.revisions).toHaveLength(1);
    expect(q.revisions![0].description).toBe('Concept design issue');
    expect(q.revisions![0].snapshot.drawingSet?.status).toBe('FOR CONCEPT REVIEW');
    expect(baselineOf(q)?.revision.id).toBe('A');
    expect(q.stage?.gates).toEqual([{ stage: 'concept', date: '2026-10-20', revisionId: 'A', by: 'PG' }]);
    expect(q.drawingSet?.status).toBe('FOR SCHEMATIC REVIEW');
    expect(q.drawingSet?.sheets[0].status).toBeUndefined(); // PRELIMINARY follows the stage
    expect(q.drawingSet?.sheets[1].status).toBe('AS-BUILT'); // a status typed by hand is kept
  });

  it('runs concept → schematic → detailed → IFC, and IFC stays frozen once issued', () => {
    let p = newProject('A');
    for (let i = 0; i < 3; i++) p = advanceStage(p, { date: '2026-10-20' });
    expect(stageOf(p)).toBe('ifc');
    expect(nextStage(p)).toBeUndefined();
    expect(ifcIssued(p)).toBe(false);
    p = advanceStage(p, { date: '2026-10-21' });
    expect(stageOf(p)).toBe('ifc');
    expect(ifcIssued(p)).toBe(true);
    expect(p.revisions!.map((r) => r.description)).toEqual(['Concept design issue', 'Schematic design issue', 'Detailed design issue', 'Issued for construction']);
    expect(changedSinceRevision(p)).toBe(false);
  });

  it('counts findings of later stages separately', () => {
    const p = newProject('A');
    const todo = [{ status: 'bad' as const, text: 'tx', go: { view: 'sizing' as const } }, { status: 'bad' as const, text: 'vd', go: { view: 'selection' as const } }, { status: 'warn' as const, text: 'stale' }];
    const s = splitByStage(p, todo);
    expect(s.counted.map((t) => t.text)).toEqual(['tx', 'stale']);
    expect(s.later.map((t) => t.text)).toEqual(['vd']);
    expect(splitByStage({ ...p, stage: { current: 'detailed' } }, todo).later).toEqual([]);
  });

  it('lists the stage statuses for the drawings page', () => expect(stageStatusesListed()).toBe(true));

  it('builds a checklist per stage, with tender queries on the tender route', () => {
    let p = setTenderRoute(newProject('A'), 'before-ifc');
    p = withComment(p, newComment(p, { kind: 'tender-query', category: 'equipment', severity: 'minor', finding: 'Approved makes?' }));
    expect(openTenderQueries(p)).toBe(1);
    const cards = stageChecklist(p, buildDashboard(p));
    expect(cards.map((c) => [c.stage, c.state])).toEqual([['concept', 'current'], ['schematic', 'next'], ['detailed', 'next'], ['tender', 'next'], ['ifc', 'next']]);
    expect(cards[3].checks.find((c) => c.label === 'Tender queries closed')?.done).toBe(false);
    const after = stageChecklist(advanceStage(p), buildDashboard(p));
    expect(after[0]).toMatchObject({ state: 'done', gate: { revisionId: 'A' } });
  });
});

describe('ribbon follows the stages', () => {
  it('opens a project on its stage tab', () => {
    expect(tabForStage('concept')).toBe('concept');
    expect(tabForStage('detailed')).toBe('detailed');
    expect(tabForStage('tender')).toBe('issue');
    expect(tabForStage('ifc')).toBe('issue');
  });
  it('keeps the current tab when the screen is on it too', () => {
    expect(tabForView('design', 'schematic')).toBe('schematic');
    expect(tabForView('design', 'cost')).toBe('sld');
    expect(tabForView('load-schedule', 'cost')).toBe('schedule');
    expect(tabForView('load-schedule', 'reports')).toBe('reports');
    expect(tabForView('load-assessment')).toBe('concept');
    expect(tabForView('voltage-drop')).toBe('detailed');
    expect(tabForView('submissions')).toBe('issue');
    expect(tabForView('cable-schedule')).toBe('reports');
    expect(tabForView('design', 'home')).toBe('home'); // the SLD button on Project keeps the tab
    expect(tabForView('drawings', 'reports')).toBe('cad'); // sheets are in Design CAD → Sheets
    expect(tabForView('drawing-register')).toBe('cad');
  });

  it('shows the chosen tab\'s page unless the page on screen is on that tab', () => {
    expect(viewForTab('cad', 'design')).toBe('cad');
    expect(viewForTab('cad', 'cad')).toBe('cad');
    expect(viewForTab('schematic', 'cad')).toBe('design');
    expect(viewForTab('detailed', 'design')).toBe('design');
    expect(viewForTab('home', 'design')).toBe('design');
    expect(viewForTab('reports', 'cable-schedule')).toBe('cable-schedule');
    expect(viewForTab('schedule', 'cad')).toBe('load-schedule');
    expect(viewForTab('sld', 'cad')).toBe('design');
    expect(viewForTab('cost', 'design')).toBe('boq');
    expect(viewForTab('cad', 'drawings')).toBe('drawings');
    expect(viewForTab('reports', 'drawings')).toBe('load-schedule');
  });
});

describe('step back a stage', () => {
  it('returns to the previous stage, keeps the revision, drops the gate', () => {
    const p = withSheets(newProject('A'));
    const q = advanceStage(p, { date: '2026-10-20' });
    const back = stepBackStage(q);
    expect(stageOf(back)).toBe('concept');
    expect(back.stage?.gates).toEqual([]);
    expect(back.revisions).toHaveLength(1);
    expect(back.drawingSet?.status).toBe('FOR CONCEPT REVIEW');
    expect(back.drawingSet?.sheets[1].status).toBe('AS-BUILT');
    expect(stepBackStage(back)).toBe(back); // nothing before concept
  });
  it('reopens IFC after the IFC issue', () => {
    let p = newProject('A');
    for (let i = 0; i < 4; i++) p = advanceStage(p, { date: '2026-10-20' });
    expect(ifcIssued(p)).toBe(true);
    const r = stepBackStage(p);
    expect(stageOf(r)).toBe('ifc');
    expect(ifcIssued(r)).toBe(false);
    expect(stageOf(stepBackStage(r))).toBe('detailed');
  });
});
