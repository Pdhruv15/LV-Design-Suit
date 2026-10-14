// Every PDF document the app prints (drawings aside), built from the sample project:
// the print-style guard test checks them for colour, and the same set renders the
// before / after PDF samples.
import { sampleProject } from '../../src/data/sampleProject';
import { runCalculations } from '../../src/calc/runs';
import { buildDashboard } from '../../src/calc/dashboard';
import { calcPfc, PFC_CALC_DEFAULT } from '../../src/calc/pfcCalc';
import { calcContainment, CONTAINMENT_DEFAULT } from '../../src/calc/containment';
import { UPS_DEFAULTS } from '../../src/calc/ups';
import { PV_DEFAULTS, sizePv } from '../../src/calc/solar';
import { emptyTrayPlan, sizeAll } from '../../src/calc/cableTray';
import type { TrayPlan } from '../../src/types';
import { buildReportHtml } from '../../src/docs/report';
import { buildSection, buildStudyReportHtml, scopeOf, STUDIES, type CalcData } from '../../src/docs/studyReport';
import { buildReviewDoc, defaultSetup, reviewHtml } from '../../src/docs/reviewReport';
import { buildClarificationDoc } from '../../src/docs/clarificationReport';
import { buildDashboardHtml } from '../../src/docs/dashboardPdf';
import { pfcReportHtml } from '../../src/docs/pfcReport';
import { containmentReportHtml } from '../../src/docs/containmentReport';
import { buildPvReportHtml, buildUpsReportHtml } from '../../src/docs/upsSolarReport';
import { buildTrayReportHtml } from '../../src/docs/trayReport';
import { buildLoadScheduleHtml } from '../../src/docs/loadScheduleDoc';
import { scheduleHtml, workbookHtml } from '../../src/docs/sheetPdf';
import { buildFormWorkbook } from '../../src/docs/formWorkbook';
import { cableSchedule } from '../../src/docs/schedules';
import { buildDmFormHtml } from '../../src/docs/dmForm';
import { packageCoverHtml, snapshotId } from '../../src/docs/issuePackage';
import { registerHtml, transmittalHtml } from '../../src/model/drawingSet';

export function printDocs(project = sampleProject): Record<string, string> {
  const run = runCalculations(project);
  const p = run.project;
  const data: CalcData = { project: p, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
  const scope = scopeOf(p, { boards: [], downstream: true });
  const sections = STUDIES.map((s) => buildSection(s.key, data, scope));
  const now = new Date('2026-10-15T10:00:00Z');
  const plan: TrayPlan = { ...emptyTrayPlan(), routes: [{ id: 'r', name: 'A', lengthM: 20, fittings: { bends: 2 }, cables: [{ id: 'c', cores: 4, csaMm2: 95, qty: 2 }, { id: 'e', cores: 1, csaMm2: 50, qty: 1 }] }] };
  const pfcIn = { ...PFC_CALC_DEFAULT, title: 'MDB-1' };
  const ups = { ...UPS_DEFAULTS, id: 'u', name: 'UPS-1', loads: [{ id: 'a', name: 'Servers', qty: 10, w: 1000, pf: 0.9 }] };
  const issue = { id: 'T-001', date: '2026-10-15', purpose: 'FOR APPROVAL', description: 'First issue', to: 'DEWA', sheets: [{ id: 'a', number: 'E-SLD-001', title: 'SLD — MDB-1', rev: 'A' }] };
  const board = p.boards.find((b) => b.id === 'DB-GF1') ?? p.boards[p.boards.length - 1];
  return {
    'calculation-report': buildReportHtml(p),
    'study-report': buildStudyReportHtml(p, scope, sections, { title: 'Electrical design report', docNo: 'E-RPT-001', preparedBy: 'QA' }, {}, { designBasis: true, results: true, data }),
    'technical-review': reviewHtml(buildReviewDoc(p, defaultSetup(), { ran: true, stale: ['Short circuit'], findings: ['F-02 voltage drop FAIL'] }, now)),
    'clarification': reviewHtml(buildClarificationDoc(p, { title: 'Technical clarification' }, now)),
    'project-summary': buildDashboardHtml(p, buildDashboard(p, run)),
    'pfc-calculation': pfcReportHtml(p, pfcIn, calcPfc(pfcIn)),
    'containment': containmentReportHtml(p, CONTAINMENT_DEFAULT, calcContainment(CONTAINMENT_DEFAULT)),
    'ups': buildUpsReportHtml(p, [ups]),
    'solar-pv': buildPvReportHtml(p, PV_DEFAULTS, sizePv(PV_DEFAULTS)),
    'cable-tray': buildTrayReportHtml(p, plan, sizeAll(p, plan)),
    'db-load-schedule': buildLoadScheduleHtml(p, board.id),
    'md-workbook': workbookHtml(p, buildFormWorkbook(p), 'MD'),
    'cable-schedule': scheduleHtml(p, cableSchedule(p), 'Cable schedule'),
    'dm-d-013': buildDmFormHtml(p, [{ id: 'a', name: 'SS-1', type: 'conventional', transformers: 2 }]),
    'issue-package-cover': packageCoverHtml(p, { title: 'Electrical studies', docNo: 'E-001', calculatedAt: Date.UTC(2026, 9, 15), snapshot: snapshotId(p) }, [{ title: 'Electrical studies', pages: 10 }], 2, sections),
    'drawing-register': registerHtml(p, [{ number: 'E-SLD-001', title: 'SLD — MDB-1', size: 'A3' }], 'A', '2026-10-15', [issue]),
    'drawing-transmittal': transmittalHtml(p, issue)
  };
}
