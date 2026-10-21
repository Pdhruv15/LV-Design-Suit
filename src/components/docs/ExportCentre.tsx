import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import type { CalcRun, StudyKey } from '../../calc/runs';
import { renderPdf, safeFileName, saveBinary } from '../../util/files';
import { revisionStamp } from '../../model/revisions';
import { ExportBar, Page } from '../ui';
import { CATALOGUE, CATEGORIES, unavailable, type ExportContext } from './exportCatalogue';

/** Export centre: every PDF document in one list, by the seven groups of the PDF plan. Tick the
 * documents and export them as a zip of PDFs or as one PDF with a bookmark per document. Each
 * document is the same as from its own page; those pages keep their own export buttons. */
export default function ExportCentre({ project, run, stale, onStatus }: { project: Project; run?: CalcRun; stale: StudyKey[]; onStatus: (m: string) => void }) {
  const ctx: ExportContext = useMemo(() => ({ project, run, stale }), [project, run, stale]);
  const why = useMemo(() => Object.fromEntries(CATALOGUE.map((e) => [e.key, unavailable(e, ctx)])), [ctx]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState('');
  const chosen = CATALOGUE.filter((e) => picked.has(e.key) && !why[e.key]);
  const desktop = typeof window !== 'undefined' && !!window.lvds?.files?.pdfBytes;
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pickAll = (on: boolean) => setPicked(new Set(on ? CATALOGUE.filter((e) => !why[e.key]).map((e) => e.key) : []));

  async function exportAs(kind: 'zip' | 'merged') {
    setBusy(kind);
    try {
      const done: { title: string; file: string; bytes: Uint8Array }[] = [];
      const failed: string[] = [];
      for (const e of chosen) {
        try {
          for (const part of e.build(ctx)) {
            onStatus(`Exporting ${done.length + 1}: ${part.title}…`);
            const bytes = await renderPdf(part.html, part.page, part.title);
            if (bytes) done.push({ title: part.title, file: part.file, bytes });
          }
        } catch (err) {
          failed.push(`${e.title} (${err instanceof Error ? err.message : String(err)})`);
        }
      }
      if (!done.length) { onStatus(failed.length ? `Nothing exported — failed: ${failed.join('; ')}` : 'Nothing exported'); return; }
      const base = safeFileName(`${project.name} - documents ${revisionStamp(project)}`);
      let m: string | null;
      if (kind === 'zip') {
        const zip = new (await import('jszip')).default();
        const used = new Set<string>();
        for (const d of done) {
          let f = `${d.file}.pdf`;
          for (let i = 2; used.has(f); i++) f = `${d.file} (${i}).pdf`;
          used.add(f);
          zip.file(f, d.bytes);
        }
        m = await saveBinary(`${base}.zip`, await zip.generateAsync({ type: 'uint8array' }), 'ZIP', 'zip', 'application/zip');
      } else {
        const { mergePdfs } = await import('../../docs/mergePdf');
        m = await saveBinary(`${base}.pdf`, await mergePdfs(done.map((d) => d.bytes), `${project.name} · ${revisionStamp(project)}`, done.map((d) => d.title)), 'PDF', 'pdf', 'application/pdf');
      }
      if (m) onStatus(`${m} — ${done.length} PDF${done.length === 1 ? '' : 's'}${failed.length ? `; failed: ${failed.join('; ')}` : ''}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <Page
      title="Export centre"
      intro="Every PDF document of the project in one list. Tick what you need and export a zip of PDFs, or one PDF with a bookmark per document. Each document is the same as from its own page, built from the saved settings and the last calculation run. Drawings and the issue package are exported from their own pages."
    >
      <ExportBar
        scope={chosen.length ? `${chosen.length} document${chosen.length === 1 ? '' : 's'} ticked` : 'Nothing ticked yet'}
        revision={revisionStamp(project)}
        blocked={!desktop ? 'PDF export needs the desktop app. In the browser, export each document from its own page (the print dialog).' : !chosen.length ? 'Tick the documents to export below.' : undefined}
        lead={<>
          <button className="chip" onClick={() => pickAll(true)}>Select all available</button>
          <button className="chip" onClick={() => pickAll(false)} disabled={!picked.size}>Clear</button>
        </>}>
        <button className="chip" disabled={!desktop || !chosen.length || !!busy} onClick={() => exportAs('zip')} title={desktop ? undefined : 'PDF export needs the desktop app'}>{busy === 'zip' ? 'Exporting…' : `Zip of PDFs (${chosen.length})`}</button>
        <button className="chip primary" disabled={!desktop || !chosen.length || !!busy} onClick={() => exportAs('merged')} title={desktop ? undefined : 'PDF export needs the desktop app'}>{busy === 'merged' ? 'Exporting…' : 'One PDF'}</button>
      </ExportBar>
      {CATEGORIES.map((cat, i) => {
        const entries = CATALOGUE.filter((e) => e.category === cat);
        return (
          <section key={cat} className="card export-group">
            <h3>{i + 1}. {cat}</h3>
            <table className="schedule"><tbody>
              {entries.map((e) => {
                const reason = why[e.key];
                return (
                  <tr key={e.key} className={reason ? 'm' : undefined}>
                    <td style={{ width: 28 }}><input type="checkbox" aria-label={e.title} disabled={!!reason} checked={!reason && picked.has(e.key)} onChange={() => toggle(e.key)} /></td>
                    <td style={{ width: '30%' }}><b>{e.title}</b></td>
                    <td style={{ whiteSpace: 'normal' }}>{e.description}{reason && <div className="warn">{reason}</div>}</td>
                  </tr>
                );
              })}
            </tbody></table>
          </section>
        );
      })}
    </Page>
  );
}
