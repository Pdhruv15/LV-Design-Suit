import type { Project } from '../../types';
import type { CalcRun, StudyKey } from '../../calc/runs';
import type { PdfPage } from '../../util/files';
import { safeFileName } from '../../util/files';
import { buildDashboard } from '../../calc/dashboard';
import { calcPfc } from '../../calc/pfcCalc';
import { calcContainment } from '../../calc/containment';
import { sizePv } from '../../calc/solar';
import { sizeAll } from '../../calc/cableTray';
import { buildBom } from '../../calc/bom';
import { buildingInfoOf } from '../../calc/building';
import { riserVd } from '../../calc/busbar';
import { vdCandidates, vdRows, worstFinalCircuits } from '../../calc/voltageDrop';
import { isScheduleCircuit } from '../../calc/loadSchedule';
import { priceBom } from '../../model/priceList';
import { numberBom } from '../../model/boqRevisions';
import { currentRevision } from '../../model/revisions';
import { buildReportHtml } from '../../docs/calcReport';
import { buildSection, buildStudyReportHtml, defaultTitle, scopeOf, setupOf, type CalcData } from '../../docs/studyReport';
import { matchingType } from '../../docs/reportTypes';
import { pageFrame, reportDoc, type ReportMeta } from '../../docs/reportFrame';
import { buildVdReportHtml } from '../../docs/voltageDropReport';
import { pfcReportHtml } from '../../docs/pfcReport';
import { buildPvReportHtml, buildUpsReportHtml } from '../../docs/upsSolarReport';
import { containmentReportHtml } from '../../docs/containmentReport';
import { buildTrayReportHtml } from '../../docs/trayReport';
import { buildLoadScheduleHtml } from '../../docs/loadScheduleDoc';
import { scheduleHtml, workbookHtml } from '../../docs/sheetPdf';
import { buildFormWorkbook } from '../../docs/formWorkbook';
import { cableSchedule, dbSchedule, equipmentSchedule } from '../../docs/schedules';
import { buildDmFormHtml } from '../../docs/dmForm';
import { registerHtml } from '../../docs/drawingRegister';
import { boqBookmarks, buildBoqHtml } from '../../docs/boqWorkbook';
import { buildVariationHtml } from '../../docs/variationReport';
import { buildSubmissionRegisterHtml } from '../../docs/submissionReport';
import { buildDashboardHtml } from '../../docs/dashboardPdf';
import { buildingSummaryHtml } from '../../docs/buildingSummary';
import { registerRows } from './sheetRender';

/** The export centre's catalogue: every PDF document the app makes from the saved project and the
 * last calculation run, in the seven groups of the PDF plan. Each entry is built by the same
 * functions as its own page, with the settings saved in the project. Drawings (SLD and circuit
 * sheets) and the issue package stay on their own pages: they need the drawing canvas. */

export const CATEGORIES = [
  'Engineering design reports', 'Electrical calculations', 'Electrical schedules', 'Authority submission forms',
  'Electrical drawings', 'Commercial reports', 'Project and document management'
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface ExportContext {
  /** The project as edited now. */
  project: Project;
  /** The last calculation run (results), if any. */
  run?: CalcRun;
  /** Studies whose inputs changed since the run. */
  stale: StudyKey[];
}

/** One PDF of a document (a document can be several, e.g. one load schedule per board). */
export interface ExportPart { title: string; file: string; html: string; page: PdfPage }

export interface CatalogueEntry {
  key: string;
  category: Category;
  title: string;
  description: string;
  /** Uses the calculation results: unavailable until the calculations are run and current. */
  needsRun?: boolean;
  /** Why the document cannot be made from this project (nothing to export), else undefined. */
  missing?: (c: ExportContext) => string | undefined;
  build: (c: ExportContext) => ExportPart[];
}

const A4 = (landscape = false, extra: PdfPage = {}): PdfPage => ({ pageSize: 'A4', landscape, ...extra });
const SELF = { cssPages: true, selfNumbered: true } as const;
const one = (title: string, file: string, html: string, page: PdfPage): ExportPart[] => [{ title, file, html, page }];
const name = (c: ExportContext, what: string) => safeFileName(`${c.project.name} - ${what}`);
/** The calculated project when the results are current, else the project as edited. */
const calc = (c: ExportContext) => (c.run && !c.stale.length ? c.run.project : c.project);

export const CATALOGUE: CatalogueEntry[] = [
  // 1. Engineering design reports
  { key: 'calc-report', category: 'Engineering design reports', title: 'Calculation report', needsRun: true,
    description: 'Results summary, design basis and every calculation section — the same as Reports → Calc report.',
    build: (c) => one('Calculation report', name(c, 'calculation report'), buildReportHtml({ ...calc(c), calcReportDocNo: c.project.calcReportDocNo }), A4(true, SELF)) },
  { key: 'study-report', category: 'Engineering design reports', title: 'Study report (as set up)', needsRun: true,
    description: 'The study report with the studies, scope and document details chosen on Reports → Study reports. Single line diagrams are left out here — export from that page to include them.',
    build: (c) => {
      const p = calc(c), run = c.run!;
      const setup = setupOf(c.project);
      const scope = scopeOf(p, setup);
      const data: CalcData = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
      const sections = setup.studies.map((k) => buildSection(k, data, scope));
      const title = setup.title || defaultTitle(setup.studies, matchingType(setup));
      const meta: ReportMeta = { title, docNo: setup.docNo, projectNo: setup.projectNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy, approvedBy: setup.approvedBy, issueStatus: setup.issueStatus };
      const opts = { designBasis: setup.designBasis !== false, results: setup.resultsSummary !== false, data, calculatedAt: run.at, current: true };
      const make = (pages: Record<string, number>) => buildStudyReportHtml(p, scope, sections, meta, {}, { ...opts, pages });
      return one(title, name(c, title), make({}), { cssPages: true, frame: pageFrame(reportDoc(p, meta)), paginate: make });
    } },

  // 2. Electrical calculations
  { key: 'voltage-drop', category: 'Electrical calculations', title: 'Voltage drop calculation (whole system)', needsRun: true,
    description: 'Every panel-to-panel and equipment cable, with busbar risers and, if chosen, each DB’s worst final circuit.',
    build: (c) => {
      const p = calc(c);
      const rows = [...vdRows(p, vdCandidates(p).map((f) => f.id)), ...(c.project.vdFinalCircuits ? worstFinalCircuits(p) : [])];
      const risers = (p.busRisers ?? []).map((r) => riserVd(p, r));
      return one('Voltage drop calculation', name(c, 'voltage drop system'), buildVdReportHtml({ ...p, vdReportDocNo: c.project.vdReportDocNo }, rows, 'Entire system', risers), A4(true, SELF));
    } },
  { key: 'pfc-calc', category: 'Electrical calculations', title: 'Power factor correction calculation',
    description: 'The standalone PFC calculator (Calculate → PFC calculator) as last entered.',
    missing: (c) => (c.project.pfcCalc ? undefined : 'No PFC calculation entered'),
    build: (c) => one('Power factor correction', name(c, 'power factor correction'), pfcReportHtml(c.project, c.project.pfcCalc!, calcPfc(c.project.pfcCalc!)), A4()) },
  { key: 'ups', category: 'Electrical calculations', title: 'UPS and battery sizing',
    description: 'Every UPS system on the UPS & battery page.',
    missing: (c) => (c.project.upsSystems?.length ? undefined : 'No UPS system entered'),
    build: (c) => one('UPS and battery sizing', name(c, 'UPS and battery sizing'), buildUpsReportHtml(c.project, c.project.upsSystems!), A4()) },
  { key: 'solar', category: 'Electrical calculations', title: 'Solar PV sizing',
    description: 'The PV array and inverters on the Solar PV page.',
    missing: (c) => (c.project.pv ? undefined : 'No PV system entered'),
    build: (c) => one('Solar PV sizing', name(c, 'Solar PV sizing'), buildPvReportHtml(c.project, c.project.pv!, sizePv(c.project.pv!, c.project.voltageV)), A4()) },
  { key: 'containment', category: 'Electrical calculations', title: 'Containment calculation',
    description: 'The tray / trunking / conduit / buried calculation as last entered.',
    missing: (c) => (c.project.containmentCalc ? undefined : 'No containment calculation entered'),
    build: (c) => one('Containment calculation', name(c, 'containment'), containmentReportHtml(c.project, c.project.containmentCalc!, calcContainment(c.project.containmentCalc!)), A4()) },

  // 3. Electrical schedules
  { key: 'load-schedules', category: 'Electrical schedules', title: 'DB load distribution schedules',
    description: 'The DEWA load distribution schedule of every board with schedule circuits, one PDF each.',
    missing: (c) => (c.project.feeders.some(isScheduleCircuit) ? undefined : 'No board has schedule circuits'),
    build: (c) => c.project.boards.filter((b) => c.project.feeders.some((f) => f.boardId === b.id && isScheduleCircuit(f)))
      .map((b) => ({ title: `Load schedule — ${b.id}`, file: safeFileName(`${b.id}-load-schedule`), html: buildLoadScheduleHtml(c.project, b.id), page: A4(true, { cssPages: true }) })) },
  { key: 'db-schedule', category: 'Electrical schedules', title: 'DB schedule', needsRun: true,
    description: 'Panel schedule of every board.',
    build: (c) => one('DB schedule', name(c, 'DB schedule'), scheduleHtml(calc(c), dbSchedule(calc(c)), 'DB schedule'), A4(true, { cssPages: true })) },
  { key: 'cable-schedule', category: 'Electrical schedules', title: 'Cable schedule', needsRun: true,
    description: 'Every cable in the installation.',
    build: (c) => one('Cable schedule', name(c, 'cable schedule'), scheduleHtml(calc(c), cableSchedule(calc(c)), 'Cable schedule'), A4(true, { cssPages: true })) },
  { key: 'equipment-schedule', category: 'Electrical schedules', title: 'Equipment schedule', needsRun: true,
    description: 'Transformers and boards.',
    build: (c) => one('Equipment schedule', name(c, 'equipment schedule'), scheduleHtml(calc(c), equipmentSchedule(calc(c)), 'Equipment schedule'), A4(true, { cssPages: true })) },
  { key: 'tray-schedule', category: 'Electrical schedules', title: 'Cable tray schedule',
    description: 'Every tray route with its cables, cross-section, summary and tray BOQ.',
    missing: (c) => (c.project.trays?.routes.length ? undefined : 'No tray routes entered'),
    build: (c) => one('Cable tray schedule', name(c, 'cable tray schedule'), buildTrayReportHtml(c.project, c.project.trays!, sizeAll(c.project, c.project.trays!)), A4()) },

  // 4. Authority submission forms
  { key: 'md-forms', category: 'Authority submission forms', title: 'Connected load, maximum demand and TCL forms',
    description: 'The DEWA forms of the whole project in one workbook PDF (layout as prescribed).',
    build: (c) => one('DEWA load forms', name(c, 'DEWA load forms'), workbookHtml(c.project, buildFormWorkbook(c.project), 'DEWA load forms'), A4(true, { cssPages: true })) },
  { key: 'dm-form', category: 'Authority submission forms', title: 'DM-D-013 substation areas',
    description: 'Minimum substation and LV room areas, one page per substation.',
    missing: (c) => (c.project.substations?.length ? undefined : 'No substation entered'),
    build: (c) => one('DM-D-013 substation areas', name(c, 'DM-D-013 substation areas'), buildDmFormHtml(c.project, c.project.substations!), A4()) },

  // 5. Electrical drawings
  { key: 'drawing-register', category: 'Electrical drawings', title: 'Drawing register',
    description: 'Every sheet with revision, date and status, and the issue history. The sheets themselves are exported from Reports → Drawings.',
    missing: (c) => (c.project.drawingSet?.sheets.length ? undefined : 'No drawing sheets set up'),
    build: (c) => {
      const set = c.project.drawingSet!, rev = currentRevision(c.project);
      return one('Drawing register', name(c, 'drawing register'), registerHtml(c.project, registerRows(set, [], rev?.id), rev?.id ?? '—', rev?.date ?? new Date().toISOString().slice(0, 10), set.issues, c.project.drawing?.company ?? c.project.info?.consultant ?? ''), A4(false, SELF));
    } },

  // 6. Commercial reports
  { key: 'boq', category: 'Commercial reports', title: 'Bill of quantities',
    description: 'The full BOQ by tender section, priced from the project price list.',
    build: (c) => {
      const bom = numberBom(priceBom(buildBom(c.project), c.project.priceList, c.project.boq), c.project.boqRevisions);
      const make = (pages: Record<string, number>) => buildBoqHtml(c.project, bom, c.project.priceList, false, pages);
      return one('Bill of quantities', name(c, 'BOQ'), make({}), A4(false, { ...SELF, paginate: make, bookmarks: boqBookmarks(bom) }));
    } },
  { key: 'boq-summary', category: 'Commercial reports', title: 'BOQ summary',
    description: 'The BOQ grand summary only.',
    build: (c) => {
      const bom = numberBom(priceBom(buildBom(c.project), c.project.priceList, c.project.boq), c.project.boqRevisions);
      return one('BOQ summary', name(c, 'BOQ summary'), buildBoqHtml(c.project, bom, c.project.priceList, true), A4(false, SELF));
    } },
  { key: 'variations', category: 'Commercial reports', title: 'Variation register',
    description: 'Every variation with its value and status.',
    missing: (c) => (c.project.variations?.length ? undefined : 'No variations recorded'),
    build: (c) => one('Variation register', name(c, 'Variation register'), buildVariationHtml(c.project), A4(false, SELF)) },

  // 7. Project and document management
  { key: 'project-summary', category: 'Project and document management', title: 'Project summary', needsRun: true,
    description: 'The one-page project dashboard: loads, transformers, studies and what is left to do.',
    build: (c) => one('Project summary', name(c, 'project summary'), buildDashboardHtml(calc(c), buildDashboard(calc(c), c.run, c.stale)), A4(true)) },
  { key: 'building-summary', category: 'Project and document management', title: 'Building summary',
    description: 'The load summary of every building.',
    missing: (c) => (buildingInfoOf(c.project).buildings.length ? undefined : 'No buildings set up'),
    build: (c) => one('Building summary', name(c, 'building summary'), buildingSummaryHtml(c.project, buildingInfoOf(c.project).buildings.map((b) => b.id)), A4()) },
  { key: 'submissions', category: 'Project and document management', title: 'Submission register',
    description: 'Every document submitted, with responses and the comments log.',
    missing: (c) => ((c.project.submissions?.length || c.project.drawingSet?.issues?.length) ? undefined : 'Nothing submitted yet'),
    build: (c) => one('Submission register', name(c, 'Submission register'), buildSubmissionRegisterHtml(c.project), A4(false, SELF)) }
];

/** Why an entry cannot be exported now, or undefined when it can. */
export function unavailable(e: CatalogueEntry, c: ExportContext): string | undefined {
  if (e.needsRun && !c.run) return 'Run the calculations first (F5)';
  if (e.needsRun && c.stale.length) return 'Results out of date — run the calculations (F5)';
  return e.missing?.(c);
}
