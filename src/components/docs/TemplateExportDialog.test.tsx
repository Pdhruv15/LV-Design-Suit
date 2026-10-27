import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleProject } from '../../data/sampleProject';
import { scheduleCircuits } from '../../calc/loadSchedule';
import TemplateExportDialog from './TemplateExportDialog';

const render = (stored: string | null) => {
  vi.stubGlobal('localStorage', { getItem: () => stored, setItem: vi.fn(), removeItem: vi.fn() });
  const db = sampleProject.boards.find((b) => scheduleCircuits(sampleProject, b.id).length)!.id;
  return { db, html: renderToStaticMarkup(<TemplateExportDialog project={sampleProject} boardId={db} onStatus={() => {}} onClose={() => {}} />) };
};
afterEach(() => vi.unstubAllGlobals());

describe('My Excel template dialog', () => {
  it('asks for a template first; Export waits for one', () => {
    const { db, html } = render(null);
    expect(html).toContain('No template chosen yet');
    expect(html).toContain('Choose…');
    expect(html).toContain(`This DB (${db})`);
    expect(html).toMatch(/All DBs \(\d+\)/);
    expect(html).toMatch(/<button type="submit" class="chip primary" disabled="">Export<\/button>/);
  });
  it('remembers the last template on this computer', () => {
    const { html } = render(JSON.stringify({ name: 'Company schedule.xlsx', data: btoa('PK') }));
    expect(html).toContain('Company schedule.xlsx');
    expect(html).toContain('Change…');
  });
});
