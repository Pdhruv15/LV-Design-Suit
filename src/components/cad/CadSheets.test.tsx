// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CadSheets from './CadSheets';
import { sampleProject } from '../../data/sampleProject';
import { evaluateProject } from '../../calc/electrical';
import { autoSheets, issueSheets, setOf, sheetHash } from '../../model/drawingSet';
import { sheetItems } from '../../model/sheetChanges';
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
    expect(html).not.toContain('<h4>Plans</h4>');
  });

  it('lists plan sheets under Plans', () => {
    const plan = { id: 'pl', number: 'E-LTG-001', title: 'Ground floor · Lighting layout', kind: 'plan' as const, plan: 'lighting' as const, buildingId: 'V', levelId: 'GF', boards: [], size: 'auto' as const, scale: '1:100' };
    const html = renderToStaticMarkup(
      <CadSheets project={{ ...project, drawingSet: { ...set, sheets: [...set.sheets, plan] } }} calcProject={project} results={[]} sheetId={null} tab="titleblock" ui={ui}
        onActive={noop} onChange={noop} onStatus={noop} onOpen={noop} />
    );
    expect(html).toMatch(/<h4>Plans<\/h4>.*E-LTG-001/s);
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

describe('Cloud the changes', () => {
  const set = setOf(project);
  const sld = set.sheets.find((s) => s.kind === 'system')!;
  const open = (p: Project) => renderToStaticMarkup(
    <CadSheets project={p} calcProject={p} results={[]} sheetId={sld.id} tab="titleblock" ui={ui} onActive={noop} onChange={noop} onStatus={noop} onOpen={noop} />
  );
  const issue = (items: boolean) => issueSheets(set, [sld.id], { date: '2026-10-30', purpose: 'FOR APPROVAL', description: '', bump: true }, undefined, (s) => sheetHash(project, set, s), items ? (s) => sheetItems(project, set, s) : undefined).set;

  it('counts the changes since the last issue', () => {
    const p = { ...project, drawingSet: issue(true) };
    expect(open(p)).toContain('No changes since Rev A.');
    const changed = { ...p, feeders: p.feeders.map((f) => (f.id === 'INC-MCC' ? { ...f, cableCsaMm2: 185 } : f)) };
    expect(open(changed)).toMatch(/Cloud the changes <small>1 since Rev A<\/small>/);
  });

  it('asks for one more issue when the sheet was issued before changes were kept, and shows nothing before the first', () => {
    expect(open({ ...project, drawingSet: issue(false) })).toContain('Issue this sheet once more');
    expect(open(project)).not.toContain('Cloud the changes');
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
