import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Project, StudyReportKind, StudyReportPreset, StudyReportSetup } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { boardsInSupplyOrder } from '../../calc/summary';
import { buildAnnotations } from '../../diagram/annotations';
import { printableSvg } from '../../diagram/exportSvg';
import {
  buildSection, buildStudyReportHtml, missingBoards, scopeMode, buildStudyWorkbook, defaultTitle, drawingProject, scopeOf, scopeText, setupOf, sldStudies, STUDIES, studyInfo, type CalcData, type Section
} from '../../docs/studyReport';
import { workbookBytes } from '../../docs/formWorkbook';
import { buildStudyDocx, docxBytes } from '../../docs/studyWord';
import { mergePdfs } from '../../docs/mergePdf';
import { packageCoverHtml, packageStamp, snapshotId, unresolvedChecks, type PackageMeta } from '../../docs/issuePackage';
import { PDFDocument } from 'pdf-lib';
import { buildDashboard } from '../../calc/dashboard';
import { buildDashboardHtml } from '../../docs/dashboardPdf';
import { buildLoadScheduleHtml } from '../../docs/loadScheduleDoc';
import { scheduleCircuits } from '../../calc/loadSchedule';
import { revisionStamp } from '../../model/revisions';
import { renderPdf, safeFileName, saveBinary, savePdf } from '../../util/files';
import { applyReportType, matchingType, REPORT_TYPES } from '../../docs/reportTypes';
import { issueCounts, validateReport } from '../../docs/reportValidation';
import { ISSUE_STATUSES, missingFields, pageFrame, reportDoc, type ReportMeta } from '../../docs/reportFrame';
import SystemDiagram from '../SystemDiagram';
import { Page, StaleBanner } from '../ui';

const noop = () => {};
/** A table row with a status cell that is a warning or worse. */
const isIssue = (r: unknown[]) => r.some((c) => typeof c === 'object' && c !== null && ((c as { s?: string }).s === 'bad' || (c as { s?: string }).s === 'warn'));

/** Draws the scope's SLD off-screen with a study's labels and colours, and
 * returns it as printable SVG. */
async function captureSld(drawing: Project, data: CalcData, key: StudyReportKind): Promise<string | undefined> {
  const sld = studyInfo(key).sld;
  if (!sld) return undefined;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;width:1800px;height:1100px;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(
      <SystemDiagram
        project={drawing}
        calcProject={data.project}
        results={data.results}
        annotations={buildAnnotations(data.project, data.results)}
        layers={sld.layers}
        colorBy={sld.colorBy}
        selectedFeederId={null}
        selectedBoardId={null}
        onSelectFeeder={noop}
        onSelectBoard={noop}
      />
    ));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const svg = host.querySelector<SVGSVGElement>('.sysdiag svg');
    return svg ? printableSvg(svg, Number(svg.dataset.w), Number(svg.dataset.h)) : undefined;
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Study reports for submissions: choose the boards (e.g. one MDB and what
 * it feeds) and the studies (short circuit, load flow…), then export a PDF —
 * one file, or one per study — with an SLD of just that part showing each
 * study's results, and the tables in Excel. */
export default function StudyReportsView({ project, me, run, stale, onRun, onChange, onStatus }: {
  project: Project;
  /** From the user's profile, while the report doesn't name anyone. */
  me?: { preparedBy?: string; checkedBy?: string };
  run?: CalcRun;
  stale: string[];
  onRun: () => void;
  onChange: (p: Project) => void;
  onStatus: (m: string) => void;
}) {
  const setup = setupOf(project);
  setup.preparedBy ??= me?.preparedBy || undefined;
  setup.checkedBy ??= me?.checkedBy || undefined;
  const set = (patch: Partial<StudyReportSetup>) => onChange({ ...project, studyReport: { ...setup, ...patch } });
  const calc = run?.project ?? project;
  const boards = boardsInSupplyOrder(project);
  const scope = useMemo(() => scopeOf(calc, setup), [calc, setup.boards, setup.downstream, setup.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const data: CalcData | undefined = run && { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
  const basisOpt = { designBasis: setup.designBasis !== false, results: setup.resultsSummary !== false, data };
  const sections: Section[] = useMemo(
    () => (data ? setup.studies.map((k) => buildSection(k, data, scope)) : []),
    [run, scope, setup.studies] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [preview, setPreview] = useState<StudyReportKind>('sc');
  const sldKeys = sldStudies(setup.studies);
  const previewKey = sldKeys.includes(preview) ? preview : sldKeys[0];
  const drawing = useMemo(() => drawingProject(calc, scope), [calc, scope]);
  const [busy, setBusy] = useState('');
  const [presetName, setPresetName] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [tabPicked, setTab] = useState<'boards' | 'studies' | 'output' | 'sld' | 'contents' | 'checks' | 'preview'>('boards');
  const presets = project.studyReportPresets ?? [];
  const title = setup.title || defaultTitle(setup.studies, matchingType(setup));
  const reportMeta: ReportMeta = { title, docNo: setup.docNo, projectNo: setup.projectNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy, approvedBy: setup.approvedBy, issueStatus: setup.issueStatus };
  const issues = useMemo(() => validateReport({ project: calc, meta: reportMeta, scope, sections, data, stale, designBasis: basisOpt.designBasis, resultsSummary: basisOpt.results }),
    [calc, scope, sections, stale, setup]); // eslint-disable-line react-hooks/exhaustive-deps
  const ic = issueCounts(issues);
  /** Errors are never hidden: exporting with any asks first. */
  const confirmIssues = () => !ic.error || window.confirm(`The pre-export check found ${ic.error} error(s) and ${ic.warning} warning(s) — see the Pre-export check tab.\n\nExport anyway?`);
  const depth = (id: string) => {
    let d = 0;
    let b = project.boards.find((x) => x.id === id);
    while (b?.upstreamId && d < 10) { d++; b = project.boards.find((x) => x.id === b!.upstreamId); }
    return d;
  };
  const chosen = new Set(setup.boards);
  const toggleBoard = (id: string) => set({ boards: chosen.has(id) ? setup.boards.filter((x) => x !== id) : [...setup.boards, id] });
  const toggleStudy = (k: StudyReportKind) => set({ studies: setup.studies.includes(k) ? setup.studies.filter((x) => x !== k) : STUDIES.map((s) => s.key).filter((x) => x === k || setup.studies.includes(x)) });
  const mode = scopeMode(setup);
  const noBoards = scope.boards.length === 0;
  const blocked = !run || stale.length > 0 || noBoards;
  const blockedWhy = !run ? 'Run the calculations first (F5)' : stale.length ? 'Results are out of date — Run (F5)' : noBoards ? 'Tick at least one board, or choose Whole installation' : undefined;

  async function exportPdf() {
    if (!data || !sections.length) return;
    if (!confirmIssues()) return;
    setBusy('pdf');
    try {
      const slds: Partial<Record<StudyReportKind, string>> = {};
      if (setup.sld) for (const k of sldStudies(sections.map((s) => s.key))) slds[k] = await captureSld(drawing, data, k);
      const meta: ReportMeta = { title, docNo: setup.docNo, projectNo: setup.projectNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy, approvedBy: setup.approvedBy, issueStatus: setup.issueStatus };
      const base = safeFileName(`${project.name} ${setup.docNo ?? ''}`.trim());
      const scopeTag = scope.all ? '' : ` ${scope.roots.map((b) => b.id).join('+')}`;
      if (setup.separate && sections.length > 1) {
        let saved = 0;
        for (const s of sections) {
          const m1 = { ...meta, title: setup.title ? `${setup.title} — ${s.title}` : s.title };
          const make = (pages: Record<string, number>) => buildStudyReportHtml(project, scope, [s], m1, slds, { ...basisOpt, pages });
          const m = await savePdf(`${base} - ${safeFileName(s.title + scopeTag)}.pdf`, make({}), { cssPages: true, frame: pageFrame(reportDoc(project, m1)), paginate: make });
          if (m) saved++;
        }
        onStatus(`Saved ${saved} of ${sections.length} study reports`);
      } else {
        const m = await savePdf(`${base} - ${safeFileName(title + scopeTag)}.pdf`, buildStudyReportHtml(project, scope, sections, meta, slds, { ...basisOpt, pages: {} }), { cssPages: true, frame: pageFrame(reportDoc(project, meta)), paginate: (pages) => buildStudyReportHtml(project, scope, sections, meta, slds, { ...basisOpt, pages }) });
        if (m) onStatus(m);
      }
    } catch (e) {
      onStatus(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
  }

  async function exportExcel() {
    if (!sections.length) return;
    if (!confirmIssues()) return;
    setBusy('xlsx');
    try {
      const bytes = await workbookBytes(buildStudyWorkbook(calc, scope, sections, { title, docNo: setup.docNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy }));
      const m = await saveBinary(`${safeFileName(`${project.name} ${title}`)}.xlsx`, bytes, 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (m) onStatus(m);
    } catch (e) {
      onStatus(`Excel export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
  }

  async function exportWord() {
    if (!sections.length) return;
    if (!confirmIssues()) return;
    setBusy('docx');
    try {
      const doc = buildStudyDocx(calc, scope, sections, reportMeta, basisOpt);
      const m = await saveBinary(`${safeFileName(`${project.name} ${title}`)}.docx`, await docxBytes(doc), 'Word document', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (m) onStatus(m);
    } catch (e) {
      onStatus(`Word export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
  }

  /** Issue package — one PDF for the submission, everything from ONE frozen
   * calculation run (the last run, never the live edits): a cover with the
   * snapshot ID, contents, unresolved checks and assumptions; the project
   * summary; the study report with its SLDs; the load schedule of every DB in
   * scope. Every page is stamped with the snapshot ID and app version. */
  async function exportPack() {
    const toBytes = window.lvds?.files?.pdfBytes;
    const snap = run; // frozen here: later edits can't mix into this package
    if (!confirmIssues()) return;
    if (!snap || !data || !sections.length) return;
    if (!toBytes) { onStatus('The issue package is made by the desktop app — download it, or use Export PDF here (opens the print dialog)'); return; }
    setBusy('pack');
    try {
      const p = snap.project;
      const snapData: CalcData = { project: p, results: snap.results, earthing: snap.earthing, selectivity: snap.selectivity };
      const snapScope = scopeOf(p, setup);
      const snapSections = setup.studies.map((k) => buildSection(k, snapData, snapScope));
      const slds: Partial<Record<StudyReportKind, string>> = {};
      if (setup.sld) for (const k of sldStudies(snapSections.map((s) => s.key))) slds[k] = await captureSld(drawingProject(p, snapScope), snapData, k);
      const meta: ReportMeta = { title, docNo: setup.docNo, projectNo: setup.projectNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy, approvedBy: setup.approvedBy, issueStatus: setup.issueStatus };
      const parts: Uint8Array[] = [];
      parts.push(await toBytes({ html: buildDashboardHtml(p, buildDashboard(p, snap)), cssPages: true }));
      // The study report exactly as Export PDF makes it: contents page numbers, header and footer.
      const report = (pages: Record<string, number>) => buildStudyReportHtml(p, snapScope, snapSections, meta, slds, { ...basisOpt, data: snapData, pages });
      parts.push((await renderPdf(report({}), { cssPages: true, frame: pageFrame(reportDoc(p, meta)), paginate: report }, title))!);
      const dbs = snapScope.boards.filter((b) => scheduleCircuits(p, b.id).length);
      for (const b of dbs) parts.push(await toBytes({ html: buildLoadScheduleHtml(p, b.id), cssPages: true }));
      const titles = ['Project summary', title, ...dbs.map((b) => `Load schedule — ${b.id}`)];
      const counts = await Promise.all(parts.map(async (bytes) => (await PDFDocument.load(bytes)).getPageCount()));
      const pm: PackageMeta = { ...meta, calculatedAt: snap.at, snapshot: snapshotId(p) };
      const list = titles.map((t, i) => ({ title: t, pages: counts[i] }));
      // The cover lists page numbers, which depend on its own length: build it until that settles.
      let coverPages = 1, cover = await toBytes({ html: packageCoverHtml(p, pm, list, coverPages, snapSections), cssPages: true });
      for (let i = 0; i < 3; i++) {
        const n = (await PDFDocument.load(cover)).getPageCount();
        if (n === coverPages) break;
        coverPages = n;
        cover = await toBytes({ html: packageCoverHtml(p, pm, list, coverPages, snapSections), cssPages: true });
      }
      const bytes = await mergePdfs([cover, ...parts], packageStamp(p, pm), ['Issue package — contents and open items', ...titles]);
      const m = await saveBinary(`${safeFileName(`${project.name} ${setup.docNo ?? ''} issue package ${pm.snapshot}`.trim())}.pdf`, bytes, 'PDF', 'pdf', 'application/pdf');
      const open = unresolvedChecks(snapSections).length;
      if (m) onStatus(`${m} — snapshot ${pm.snapshot}: cover, summary, ${snapSections.length} stud${snapSections.length > 1 ? 'ies' : 'y'}, ${dbs.length} load schedule${dbs.length === 1 ? '' : 's'} · ${open} unresolved check${open === 1 ? '' : 's'} listed`);
    } catch (e) {
      onStatus(`Issue package failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
  }

  function savePreset() {
    const name = presetName.trim() || `${title} — ${scope.all ? 'all boards' : scope.roots.map((b) => b.id).join(', ')}`;
    const preset: StudyReportPreset = { ...setup, id: `p-${Date.now().toString(36)}`, name };
    onChange({ ...project, studyReportPresets: [...presets.filter((p) => p.name !== name), preset] });
    setPresetName('');
    onStatus(`Saved "${name}"`);
  }

  const tab = (tabPicked === 'sld' && !(previewKey && setup.sld && run)) || (tabPicked === 'contents' && !sections.length) || (tabPicked === 'preview' && !(data && sections.length)) ? 'studies' : tabPicked;
  const text = (k: 'title' | 'docNo' | 'projectNo' | 'preparedBy' | 'checkedBy' | 'approvedBy', label: string, placeholder = '') => (
    <label>{label}<input key={`${k}-${setup[k] ?? ''}`} defaultValue={setup[k] ?? ''} placeholder={placeholder} onBlur={(e) => e.target.value.trim() !== (setup[k] ?? '') && set({ [k]: e.target.value.trim() || undefined })} /></label>
  );

  return (
    <Page
      title="Study reports"
      intro="Reports for a submission: choose the scope (whole installation or selected boards) and the studies, then export. Calculations always cover the whole network; the report shows only the part you chose."
      actions={
        <>
          {blockedWhy && <span className="m sr-why">{blockedWhy}</span>}
          <button className="chip" disabled={blocked || !sections.length || !!busy} onClick={exportExcel} title={blockedWhy ?? 'Excel: the result tables of each study (no SLDs, no method text)'}>{busy === 'xlsx' ? 'Exporting…' : 'Excel'}</button>
          <button className="chip" disabled={blocked || !sections.length || !!busy} onClick={exportWord} title={blockedWhy ?? 'Word (.docx): editable report — method, summary and tables (no SLDs)'}>{busy === 'docx' ? 'Exporting…' : 'Word'}</button>
          <button className="chip" disabled={blocked || !sections.length || !!busy} onClick={exportPack} title={blockedWhy ?? 'One PDF from the last calculation run: cover (snapshot ID, contents, unresolved checks, assumptions) + project summary + this report with SLDs + the load schedule of every DB in scope; snapshot ID on every page'}>{busy === 'pack' ? 'Building…' : window.lvds?.files?.pdfBytes ? 'Issue package (PDF)' : 'Issue package · desktop app'}</button>
          <button className="chip primary" disabled={blocked || !sections.length || !!busy} onClick={exportPdf} title={blockedWhy ?? `PDF: method, summary and tables of each study${setup.sld ? ', with an SLD of the chosen boards showing its results' : ''}`}>
            {busy === 'pdf' ? 'Exporting…' : setup.separate && sections.length > 1 ? `Export ${sections.length} PDFs` : 'Export PDF'}
          </button>
        </>
      }
    >
      {stale.length > 0 && <StaleBanner stale={stale} onRun={onRun} what="the report" />}

      <div className="tabs sr-tabs" role="tablist">
        {([
          ['boards', '1 · Boards', noBoards ? 'none ticked' : mode === 'all' ? 'whole installation' : `${scope.ids.size} board(s)`],
          ['studies', '2 · Studies', `${setup.studies.length} of ${STUDIES.length}`],
          ['output', '3 · Output', setup.separate && sections.length > 1 ? `${sections.length} PDFs` : 'PDF'],
          ...(previewKey && setup.sld && run ? [['sld', 'SLD preview', '']] : []),
          ...(sections.length ? [['contents', 'Report contents', `${sections.length} section(s)`]] : []),
          ['checks', 'Pre-export check', ic.error ? `${ic.error} error(s)` : ic.warning ? `${ic.warning} warning(s)` : 'clear'],
          ...(data && sections.length ? [['preview', 'Preview', '']] : [])
        ] as [typeof tabPicked, string, string][]).map(([k, label, sub]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}{sub && <span className={`m sr-tab-sub${(k === 'boards' && noBoards) || (k === 'checks' && ic.error) ? ' warn' : ''}`}> · {sub}</span>}
          </button>
        ))}
      </div>

      <div className="sr-pane">
        {tab === 'boards' && <section className="sr-box">
          <div className="seg sr-mode" role="radiogroup" aria-label="Report scope">
            <button role="radio" aria-checked={mode === 'all'} className={mode === 'all' ? 'on' : ''} onClick={() => set({ mode: 'all' })}>Whole installation</button>
            <button role="radio" aria-checked={mode === 'selected'} className={mode === 'selected' ? 'on' : ''} onClick={() => set({ mode: 'selected' })}>Selected boards</button>
          </div>
          {boards.filter((b) => !b.upstreamId).length > 1 && (
            <div className="sr-quick">
              {boards.filter((b) => !b.upstreamId).map((b) => (
                <button key={b.id} className="chip" onClick={() => set({ mode: 'selected', boards: [b.id], downstream: true })}>{b.id} and downstream</button>
              ))}
            </div>
          )}
          {mode === 'selected' && <label className="sr-check"><input type="checkbox" checked={setup.downstream} onChange={(e) => set({ downstream: e.target.checked })} /> Include everything below the chosen boards</label>}
          {mode === 'selected' && missingBoards(project, setup.boards).length > 0 && (
            <p className="warn">{missingBoards(project, setup.boards).length} chosen board(s) no longer exist: {missingBoards(project, setup.boards).join(', ')}. <button className="linkish" onClick={() => set({ boards: setup.boards.filter((id) => project.boards.some((b) => b.id === id)) })}>Remove them</button></p>
          )}
          {mode === 'selected' && <div className="sr-tree">
            {boards.map((b) => {
              const inScope = scope.ids.has(b.id);
              const implied = inScope && !chosen.has(b.id);
              return (
                <label key={b.id} style={{ paddingLeft: depth(b.id) * 16 }} className={implied ? 'implied' : ''}>
                  <input type="checkbox" checked={chosen.has(b.id) || implied} onChange={() => toggleBoard(b.id)} disabled={implied} />
                  <b>{b.id}</b> <span className="m">{b.name !== b.id ? b.name : ''}</span>
                </label>
              );
            })}
          </div>}
          <p className={noBoards ? 'warn' : 'm'}>{noBoards ? 'No board ticked — tick at least one board, or choose Whole installation.' : `In the report: ${scopeText(calc, scope)}`}</p>
          <p className="m">{scope.feeders.length + scope.incomers.length} circuits{scope.finals.length ? ` + ${scope.finals.length} final circuits (cable and earthing studies)` : ''}.</p>
        </section>}

        {tab === 'studies' && <section className="sr-box sr-types">
          <h4 className="sr-sub">Report type <span className="m">— sets the sections below; tick sections on or off to customise</span></h4>
          <div className="sr-type-list">
            {REPORT_TYPES.map((t) => (
              <button key={t.key} className={`chip${matchingType(setup) === t.key ? ' on' : ''}`} title={t.description} onClick={() => set(applyReportType(t.key))}>{t.label}</button>
            ))}
            {!matchingType(setup) && <span className="m">Custom selection</span>}
          </div>
          {matchingType(setup) === 'authority' && (
            <label className="sr-check"><input type="checkbox" checked={setup.studies.includes('lf')} onChange={() => toggleStudy('lf')} /> Include voltage drop calculations <span className="m">(usually only for larger jobs with several LV panels)</span></label>
          )}
        </section>}
        {tab === 'studies' && <section className="sr-box sr-studies">
          {STUDIES.map((s) => {
            const sec = sections.find((x) => x.key === s.key);
            const bad = sec?.statuses.filter((x) => x === 'bad').length ?? 0;
            const warn = sec?.statuses.filter((x) => x === 'warn').length ?? 0;
            return (
              <label key={s.key} className="sr-study">
                <input type="checkbox" checked={setup.studies.includes(s.key)} onChange={() => toggleStudy(s.key)} />
                <span>
                  <b>{s.label}</b>
                  {sec && sec.statuses.length > 0 && (
                    <em className="sr-counts">
                      <span className="ok">{sec.statuses.length - bad - warn} pass</span>
                      {warn > 0 && <span className="warn"> · {warn} warning</span>}
                      {bad > 0 && <span className="bad"> · {bad} exceed</span>}
                    </em>
                  )}
                  <small>{s.description}{s.sld || s.description.includes('(tables only)') ? '' : ' (tables only)'}</small>
                </span>
              </label>
            );
          })}
          {!setup.studies.length && <p className="m">Tick at least one study.</p>}
        </section>}

        {tab === 'output' && <section className="sr-box">
          <label className="sr-check"><input type="checkbox" checked={setup.sld} onChange={(e) => set({ sld: e.target.checked })} /> SLD of the chosen boards with each study's results (A3 page)</label>
          <label className="sr-check"><input type="checkbox" checked={setup.designBasis !== false} onChange={(e) => set({ designBasis: e.target.checked })} /> Executive summary and design basis (scope, system description, codes and standards, design criteria) before the studies</label>
          <label className="sr-check"><input type="checkbox" checked={setup.resultsSummary !== false} onChange={(e) => set({ resultsSummary: e.target.checked })} /> Results and compliance summaries (equipment, load, cables, charts, design checks) after the studies</label>
          <label className="sr-check"><input type="checkbox" checked={setup.separate} onChange={(e) => set({ separate: e.target.checked })} /> A separate PDF for each study</label>
          <div className="sr-fields">
            {text('title', 'Report title', defaultTitle(setup.studies, matchingType(setup)))}
            {text('docNo', 'Document no.', 'e.g. E-CALC-003')}
            {text('projectNo', 'Project no.')}
            {text('preparedBy', 'Prepared by')}
            {text('checkedBy', 'Checked by')}
            {text('approvedBy', 'Approved by')}
            <label>Issue status<select value={setup.issueStatus ?? ''} onChange={(e) => set({ issueStatus: (e.target.value || undefined) as StudyReportSetup['issueStatus'] })}>
              <option value="">Not defined</option>
              {ISSUE_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select></label>
          </div>
          {(() => {
            const gaps = missingFields(reportDoc(project, { title, docNo: setup.docNo, projectNo: setup.projectNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy, approvedBy: setup.approvedBy, issueStatus: setup.issueStatus }));
            return gaps.length ? <p className="warn">Shown as "Not defined" in the report: {gaps.join(', ')}. Client, consultant and contractor come from the project information; the revision from Revisions.</p> : null;
          })()}
          <label className="sr-standards">Project standards and specifications <span className="m">(one per line; listed under Codes and standards — none are assumed)</span>
            <textarea rows={4} key={(project.standards ?? []).join('\n')} defaultValue={(project.standards ?? []).join('\n')} placeholder={'e.g. DEWA Regulations for Electrical Installations 2017\nProject specification Section 26 05 00'}
              onBlur={(e) => { const v = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); if (v.join('\n') !== (project.standards ?? []).join('\n')) onChange({ ...project, standards: v.length ? v : undefined }); }} /></label>
          <h4 className="sr-sub">Saved report sets</h4>
          <div className="sr-presets">
            {presets.map((p) => (
              <span key={p.id} className="sr-preset">
                <button className="chip" title={`${p.studies.map((k) => studyInfo(k).label).join(', ')} — ${(p.mode ?? (p.boards.length ? 'selected' : 'all')) === 'all' ? 'whole installation' : p.boards.join(', ')}`} onClick={() => {
                  const { id: _i, name: _n, ...rest } = p;
                  const gone = missingBoards(project, rest.boards);
                  const kept = rest.boards.filter((id) => !gone.includes(id));
                  // A set made for chosen boards stays a "selected boards" report — never silently the whole installation.
                  set({ ...rest, mode: rest.mode ?? (rest.boards.length ? 'selected' : 'all'), boards: kept });
                  onStatus(gone.length ? `Loaded "${p.name}" — ${gone.length} board(s) no longer exist and were left out: ${gone.join(', ')}${kept.length ? '' : '. Tick the boards again.'}` : `Loaded "${p.name}"`);
                }}>{p.name}</button>
                <button className="icon-btn" title={`Delete "${p.name}"`} onClick={() => onChange({ ...project, studyReportPresets: presets.filter((x) => x.id !== p.id) })}>✕</button>
              </span>
            ))}
            {!presets.length && <span className="m">Save this choice of boards and studies to repeat it for the next revision.</span>}
          </div>
          <div className="sr-save">
            <input value={presetName} placeholder="Name, e.g. Building A — short circuit" onChange={(e) => setPresetName(e.target.value)} />
            <button className="chip" onClick={savePreset}>Save set</button>
          </div>
        </section>}
      </div>

      {tab === 'sld' && previewKey && setup.sld && run && (
        <>
          <h3 className="section-title">
            {setup.studies.filter((k) => studyInfo(k).sld).map((k) => (
              <button key={k} className={`chip${k === previewKey ? ' primary' : ''}`} onClick={() => setPreview(k)}>{studyInfo(k).label}</button>
            ))}
          </h3>
          <p className="m">{studyInfo(previewKey).sld?.note}</p>
          <div className={`sr-sld${stale.length ? ' stale' : ''}`}>
            <SystemDiagram
              project={drawing}
              calcProject={run.project}
              results={run.results}
              annotations={buildAnnotations(run.project, run.results)}
              layers={studyInfo(previewKey).sld!.layers}
              colorBy={studyInfo(previewKey).sld!.colorBy}
              selectedFeederId={null}
              selectedBoardId={null}
              onSelectFeeder={noop}
              onSelectBoard={noop}
            />
          </div>
        </>
      )}

      {tab === 'checks' && (
        <section className="sr-box sr-checks">
          <p className="m">Checked before every export. Errors ask for confirmation; nothing is hidden or changed in the report.</p>
          {issues.length ? <table className="schedule"><thead><tr><th>Level</th><th>Area</th><th>Issue</th></tr></thead><tbody>
            {issues.map((x, i) => <tr key={i}><td className={x.level === 'error' ? 'bad' : x.level === 'warning' ? 'warn' : 'm'}>{x.level.toUpperCase()}</td><td>{x.area}</td><td>{x.message}</td></tr>)}
          </tbody></table> : <p className="ok">No issues found.</p>}
        </section>
      )}
      {tab === 'preview' && data && sections.length > 0 && (
        <section className="sr-preview">
          <p className="m">The report as it will print (single line diagrams are added on export; page header, footer and numbers are added to the PDF).</p>
          <iframe title="Report preview" sandbox="" srcDoc={buildStudyReportHtml(calc, scope, sections, reportMeta, {}, basisOpt)} />
        </section>
      )}
      {tab === 'contents' && sections.length > 0 && (
        <>
          <h3 className="section-title"><label className="row m sr-issues"><input type="checkbox" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} /> Issues only</label></h3>
          <div className="sr-contents">
            {sections.map((s, i) => (
              <details key={s.key} open={i === 0}>
                <summary><b>{i + 1}. {s.title}</b> {s.summary.map((k) => <span key={k.label} className={`m ${k.status ?? ''}`}> · {k.label}: {k.value}</span>)}</summary>
                {s.tables.map((t) => (
                  <div key={t.title} className="sr-table">
                    <h5>{t.title} <span className="m">({t.rows.length})</span></h5>
                    <table className="schedule">
                      <thead><tr>{t.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {(issuesOnly ? t.rows.filter(isIssue) : t.rows).slice(0, 40).map((r, y) => <tr key={y}>{r.map((c, x) => (typeof c === 'object' ? <td key={x} className={c.s}>{c.v}</td> : <td key={x}>{c}</td>))}</tr>)}
                        {(issuesOnly ? t.rows.filter(isIssue) : t.rows).length > 40 && <tr><td colSpan={t.headers.length} className="m">Showing 40 of {(issuesOnly ? t.rows.filter(isIssue) : t.rows).length} rows here — every row is in the exports.</td></tr>}
                        {issuesOnly && t.rows.length > 0 && !t.rows.some(isIssue) && <tr><td colSpan={t.headers.length} className="m">No issues in this table</td></tr>}
                        {!t.rows.length && <tr><td colSpan={t.headers.length} className="m">Nothing in scope</td></tr>}
                      </tbody>
                    </table>
                  </div>
                ))}
              </details>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
