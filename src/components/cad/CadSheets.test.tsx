// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CadSheets from './CadSheets';
import { sampleProject } from '../../data/sampleProject';
import { evaluateProject } from '../../calc/electrical';
import { autoSheets, setOf } from '../../model/drawingSet';
import type { Project } from '../../types';

const noop = () => {};
const project: Project = { ...sampleProject, drawingSet: autoSheets(sampleProject, 'perMdb') }; // an SLD and the earthing schematic
const render = (sheetId: string | null) => renderToStaticMarkup(
  <CadSheets project={project} calcProject={project} results={evaluateProject(project)} sheetId={sheetId} tab="titleblock"
    onActive={noop} onChange={noop} onStatus={noop} onOpen={noop} />
);

describe('Design CAD → Sheets', () => {
  const set = setOf(project);
  const earthing = set.sheets.find((s) => s.kind === 'earthing')!;

  it('lists every sheet by group, with the register when none is open', () => {
    const html = render(null);
    expect(html).toContain('All sheets');
    expect(html).toContain('<h4>SLD</h4>');
    expect(html).toContain('<h4>Earthing</h4>');
    for (const s of set.sheets) expect(html).toContain(s.number);
    expect(html).toContain('Title block &amp; numbering'); // the register, on the tab chosen in the ribbon
  });

  it('opens a sheet with its markup tools, earthing sheets included', () => {
    const html = render(earthing.id);
    expect(html).toContain('class="sheet-ws');
    expect(html).toContain('Markup');
    expect(html).toContain('aria-label="Sheet"'); // its settings on the right
  });
});
