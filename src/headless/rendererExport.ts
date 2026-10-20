import { runCalculations } from '../calc/runs';
import { CATALOGUE } from '../components/docs/exportCatalogue';
import { dxfFiles } from '../components/docs/sheetRender';
import { setOf } from '../model/drawingSet';
import { renderPdf } from '../util/files';
import type { Project } from '../types';

/** The renderer half of the headless export (electron/headlessExport.cjs loads the built app with
 * ?lvds-export): the app's own Reports → Drawings DXF export and Export centre PDF rendering, run on
 * the project lvds sends. Files come back to lvds, which checks the approval and writes them. */

export type ExportJob =
  | { kind: 'sheets-dxf'; project: Project; only?: string[] }
  | { kind: 'report-pdf'; project: Project; report: string; author?: string };
export interface JobFile { name: string; about: string; data: string | Uint8Array }

export async function runJob(job: ExportJob): Promise<{ files: JobFile[] }> {
  const run = runCalculations(job.project);
  if (job.kind === 'sheets-dxf') {
    const set = setOf(job.project);
    const files = await dxfFiles(job.project, set, run, job.only);
    return { files: files.map((f) => ({ name: f.name, data: f.data, about: `DXF${f.continuation ? ', continuation sheet' : ''}${f.warnings.length ? ` — ${f.warnings.join('; ')}` : ''}` })) };
  }
  const entry = CATALOGUE.find((e) => e.key === job.report);
  if (!entry) throw new Error(`No report ${job.report}.`);
  // The PDF's author, as the app takes it from the user's profile (this window has its own, empty profile).
  if (job.author) localStorage.setItem('lvds.preferences', JSON.stringify({ profile: { name: job.author } }));
  const files: JobFile[] = [];
  for (const part of entry.build({ project: job.project, run, stale: [] })) {
    const bytes = await renderPdf(part.html, part.page, part.title);
    if (!bytes) throw new Error('PDF rendering is not available in this window.');
    files.push({ name: `${part.file}.pdf`, data: bytes, about: `${part.title} (PDF)` });
  }
  return { files };
}

export function install(): void {
  (window as { __lvdsExport?: typeof runJob }).__lvdsExport = runJob;
}
