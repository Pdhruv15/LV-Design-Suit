// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CadSheets from './CadSheets';
import { sampleProject } from '../../data/sampleProject';
import { evaluateProject } from '../../calc/electrical';
import { autoSheets, setOf } from '../../model/drawingSet';
import { NO_SHEET_ACTIONS, useSheetUi, type SheetUi } from '../sld/sheetUi';
import type { Project } from '../../types';

const noop = () => {};
const ui: SheetUi = { tool: 'select', setTool: noop, color: 'black', setColor: noop, size: 3.5, setSize: noop, selId: null, setSelId: noop, zoom: 'fit', setZoom: noop, pct: '', setPct: noop, side: false, setSide: noop, actions: { current: NO_SHEET_ACTIONS } };
const project: Project = { ...sampleProject, drawingSet: autoSheets(sampleProject, 'perMdb') }; // an SLD and the earthing schematic
const render = (sheetId: string | null) => renderToStaticMarkup(
  <CadSheets project={project} calcProject={project} results={evaluateProject(project)} sheetId={sheetId} tab="titleblock" ui={ui}
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
    expect(html).toContain('Markups (0)'); // earthing sheets have markups too
    expect(html).toContain('aria-label="Sheet"'); // its settings on the right
    expect(html).not.toMatch(/<button[^>]*>(<span[^>]*><\/span>)?Publish/); // the sheet's buttons are on the ribbon
    expect(html).not.toContain('Side by side');
  });
});

describe('the open sheet\'s tools', () => {
  it('start with Select and black markups', () => {
    let got: SheetUi | undefined;
    const Probe = () => { got = useSheetUi(); return null; };
    renderToStaticMarkup(<Probe />);
    expect([got?.tool, got?.color, got?.size, got?.zoom]).toEqual(['select', 'black', 3.5, 'fit']);
  });
});
