import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Project, StudyReportKind, StudyReportPreset, StudyReportSetup } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { boardsInSupplyOrder } from '../../calc/summary';
import { buildAnnotations } from '../../diagram/annotations';
import { printableSvg } from '../../diagram/exportSvg';
import {
  buildSection, buildStudyReportHtml, buildStudyWorkbook, defaultTitle, drawingProject, scopeOf, scopeText, setupOf, STUDIES, studyInfo, type CalcData, type Section
} from '../../docs/studyReport';
import { workbookBytes } from '../../docs/formWorkbook';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import SystemDiagram from '../SystemDiagram';
import { Page, StaleBanner } from '../ui';

const noop = () => {};

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
export default function StudyReportsView({ project, run, stale, onRun, onChange, onStatus }: {
  project: Project;
  run?: CalcRun;
  stale: string[];
  onRun: () => void;
  onChange: (p: Project) => void;
  onStatus: (m: string) => void;
}) {
  const setup = setupOf(project);
  const set = (patch: Partial<StudyReportSetup>) => onChange({ ...project, studyReport: { ...setup, ...patch } });
  const calc = run?.project ?? project;
  const boards = boardsInSupplyOrder(project);
  const scope = useMemo(() => scopeOf(calc, setup), [calc, setup.boards, setup.downstream]); // eslint-disable-line react-hooks/exhaustive-deps
  const data: CalcData | undefined = run && { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
  const sections: Section[] = useMemo(
    () => (data ? setup.studies.map((k) => buildSection(k, data, scope)) : []),
    [run, scope, setup.studies] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [preview, setPreview] = useState<StudyReportKind>('sc');
  const previewKey = setup.studies.includes(preview) && studyInfo(preview).sld ? preview : setup.studies.find((k) => studyInfo(k).sld);
  const drawing = useMemo(() => drawingProject(calc, scope), [calc, scope]);
  const [busy, setBusy] = useState('');
  const [presetName, setPresetName] = useState('');
  const presets = project.studyReportPresets ?? [];
  const title = setup.title || defaultTitle(setup.studies);
  const depth = (id: string) => {
    let d = 0;
    let b = project.boards.find((x) => x.id === id);
    while (b?.upstreamId && d < 10) { d++; b = project.boards.find((x) => x.id === b!.upstreamId); }
    return d;
  };
  const chosen = new Set(setup.boards);
  const toggleBoard = (id: string) => set({ boards: chosen.has(id) ? setup.boards.filter((x) => x !== id) : [...setup.boards, id] });
  const toggleStudy = (k: StudyReportKind) => set({ studies: setup.studies.includes(k) ? setup.studies.filter((x) => x !== k) : STUDIES.map((s) => s.key).filter((x) => x === k || setup.studies.includes(x)) });
  const blocked = !run || stale.length > 0;

  async function exportPdf() {
    if (!data || !sections.length) return;
    setBusy('pdf');
    try {
      const slds: Partial<Record<StudyReportKind, string>> = {};
      if (setup.sld) for (const s of sections) slds[s.key] = await captureSld(drawing, data, s.key);
      const meta = { title, docNo: setup.docNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy };
      const base = safeFileName(`${project.name} ${setup.docNo ?? ''}`.trim());
      const scopeTag = scope.all ? '' : ` ${scope.roots.map((b) => b.id).join('+')}`;
      if (setup.separate && sections.length > 1) {
        let saved = 0;
        for (const s of sections) {
          const html = buildStudyReportHtml(calc, scope, [s], { ...meta, title: setup.title ? `${setup.title} — ${s.title}` : s.title }, slds);
          const m = await savePdf(`${base} - ${safeFileName(s.title + scopeTag)}.pdf`, html, { cssPages: true });
          if (m) saved++;
        }
        onStatus(`Saved ${saved} of ${sections.length} study reports`);
      } else {
        const m = await savePdf(`${base} - ${safeFileName(title + scopeTag)}.pdf`, buildStudyReportHtml(calc, scope, sections, meta, slds), { cssPages: true });
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
    setBusy('xlsx');
    try {
      const bytes = await workbookBytes(buildStudyWorkbook(calc, scope, sections, { title, docNo: setup.docNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy }));
      const m = await saveBinary(`${safeFileName(`${project.name} ${title}`)}.xlsx`, bytes, 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (m) onStatus(m);
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

  const text = (k: 'title' | 'docNo' | 'preparedBy' | 'checkedBy', label: string, placeholder = '') => (
    <label>{label}<input key={`${k}-${setup[k] ?? ''}`} defaultValue={setup[k] ?? ''} placeholder={placeholder} onBlur={(e) => e.target.value.trim() !== (setup[k] ?? '') && set({ [k]: e.target.value.trim() || undefined })} /></label>
  );

  return (
    <Page
      title="Study reports"
      intro="Reports for a submission: choose the boards (the whole installation, or e.g. one MDB and what it feeds) and the studies, then export. The calculations always cover the whole network — a board's fault level and voltage depend on everything above it — and the report shows only the part you chose, with its own SLD for each study."
      actions={
        <>
          <button className="chip" disabled={blocked || !sections.length || !!busy} onClick={exportExcel}>{busy === 'xlsx' ? 'Exporting…' : 'Excel'}</button>
          <button className="chip primary" disabled={blocked || !sections.length || !!busy} onClick={exportPdf} title={blocked ? 'Run the calculations first (F5)' : undefined}>
            {busy === 'pdf' ? 'Exporting…' : setup.separate && sections.length > 1 ? `Export ${sections.length} PDFs` : 'Export PDF'}
          </button>
        </>
      }
    >
      {stale.length > 0 && <StaleBanner stale={stale} onRun={onRun} what="the report" />}

      <div className="sr-grid">
        <section className="sr-box">
          <h4>1 · Boards</h4>
          <div className="sr-quick">
            <button className="chip" onClick={() => set({ boards: [] })}>Whole installation</button>
            {boards.filter((b) => !b.upstreamId).length > 1 && boards.filter((b) => !b.upstreamId).map((b) => (
              <button key={b.id} className="chip" onClick={() => set({ boards: [b.id], downstream: true })}>{b.id} only</button>
            ))}
          </div>
          <label className="sr-check"><input type="checkbox" checked={setup.downstream} onChange={(e) => set({ downstream: e.target.checked })} /> Include everything below the chosen boards</label>
          <div className="sr-tree">
            {boards.map((b) => {
              const inScope = scope.ids.has(b.id);
              const implied = inScope && !chosen.has(b.id) && setup.boards.length > 0;
              return (
                <label key={b.id} style={{ paddingLeft: depth(b.id) * 16 }} className={implied ? 'implied' : ''}>
                  <input type="checkbox" checked={chosen.has(b.id) || implied} onChange={() => toggleBoard(b.id)} disabled={implied} />
                  <b>{b.id}</b> <span className="m">{b.name !== b.id ? b.name : ''}</span>
                </label>
              );
            })}
          </div>
          <p className="m">{setup.boards.length ? `In the report: ${scopeText(calc, scope)}` : `No board ticked — the whole installation (${scope.boards.length} boards).`}</p>
          <p className="m">{scope.feeders.length + scope.incomers.length} circuits{scope.finals.length ? ` + ${scope.finals.length} final circuits (cable and earthing studies)` : ''}.</p>
        </section>

        <section className="sr-box">
          <h4>2 · Studies</h4>
          {STUDIES.map((s) => {
            const sec = sections.find((x) => x.key === s.key);
            const bad = sec?.statuses.filter((x) => x === 'bad').length ?? 0;
            const warn = sec?.statuses.filter((x) => x === 'warn').length ?? 0;
            return (
              <label key={s.key} className="sr-study">
                <input type="checkbox" checked={setup.studies.includes(s.key)} onChange={() => toggleStudy(s.key)} />
                <span>
                  <b>{s.label}</b>
                  {sec && sec.statuses.length > 0 && <em className={bad ? 'bad' : warn ? 'warn' : 'ok'}>{bad ? `${bad} fail` : warn ? `${warn} check` : 'all pass'}</em>}
                  <small>{s.description}{s.sld ? '' : ' (tables only)'}</small>
                </span>
              </label>
            );
          })}
        </section>

        <section className="sr-box">
          <h4>3 · Output</h4>
          <label className="sr-check"><input type="checkbox" checked={setup.sld} onChange={(e) => set({ sld: e.target.checked })} /> SLD of the chosen boards with each study's results (A3 page)</label>
          <label className="sr-check"><input type="checkbox" checked={setup.separate} onChange={(e) => set({ separate: e.target.checked })} /> A separate PDF for each study</label>
          <div className="sr-fields">
            {text('title', 'Report title', defaultTitle(setup.studies))}
            {text('docNo', 'Document no.', 'e.g. E-CALC-003')}
            {text('preparedBy', 'Prepared by')}
            {text('checkedBy', 'Checked by')}
          </div>
          <h4 className="sr-sub">Saved report sets</h4>
          <div className="sr-presets">
            {presets.map((p) => (
              <span key={p.id} className="sr-preset">
                <button className="chip" title={`${p.studies.map((k) => studyInfo(k).label).join(', ')} — ${p.boards.length ? p.boards.join(', ') : 'all boards'}`} onClick={() => { const { id: _i, name: _n, ...rest } = p; set(rest); onStatus(`Loaded "${p.name}"`); }}>{p.name}</button>
                <button className="icon-btn" title={`Delete "${p.name}"`} onClick={() => onChange({ ...project, studyReportPresets: presets.filter((x) => x.id !== p.id) })}>✕</button>
              </span>
            ))}
            {!presets.length && <span className="m">Save this choice of boards and studies to repeat it for the next revision.</span>}
          </div>
          <div className="sr-save">
            <input value={presetName} placeholder="Name, e.g. Building A — short circuit" onChange={(e) => setPresetName(e.target.value)} />
            <button className="chip" onClick={savePreset}>Save set</button>
          </div>
        </section>
      </div>

      {previewKey && setup.sld && run && (
        <>
          <h3 className="section-title">
            SLD preview
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

      {sections.length > 0 && (
        <>
          <h3 className="section-title">Report contents</h3>
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
                        {t.rows.slice(0, 40).map((r, y) => <tr key={y}>{r.map((c, x) => (typeof c === 'object' ? <td key={x} className={c.s}>{c.v}</td> : <td key={x}>{c}</td>))}</tr>)}
                        {t.rows.length > 40 && <tr><td colSpan={t.headers.length} className="m">… {t.rows.length - 40} more rows in the export</td></tr>}
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
      {!setup.studies.length && <p className="m">Tick at least one study.</p>}
    </Page>
  );
}
