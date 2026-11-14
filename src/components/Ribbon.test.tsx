import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Ribbon, { CAPTIONS, tipOf, type RibbonActions, type RibbonTab } from './Ribbon';

const noop = () => {};
const actions = (over: Partial<RibbonActions> = {}): RibbonActions => ({
  view: 'dashboard', onView: noop, tool: 'select', onTool: noop, boardId: 'MDB-1', selectedFeederId: null, selection: null,
  onAddFeeder: noop, onAddBoard: noop, onBoardProperties: noop, onEditSelected: noop, onDeleteSelected: noop, onExportDss: noop, onSettings: noop,
  onUndo: noop, onRedo: noop, canUndo: false, canRedo: false, onRun: noop, staleCount: 0,
  onNew: noop, onSave: noop, onSaveAs: noop, onAnonymizedSample: noop, onProfile: noop, onChooseFolder: noop, folderLabel: 'Folder: Projects',
  dirty: false, recent: [{ file: 'a.lvds', name: 'Villa', when: 'today' }], onOpenRecent: noop, dbIssues: 0, inboxCount: 0,
  onBom: noop, hasPriceList: false, stage: 'detailed', nextStage: 'ifc', ifcIssued: false, onAdvanceStage: noop, route: 'from-ifc', onRoute: noop, onConceptReport: noop,
  ...over
});
const render = (tab: RibbonTab, over: Partial<RibbonActions> = {}) => renderToStaticMarkup(<Ribbon tab={tab} onTab={noop} a={actions(over)} />);
const TABS = Object.keys(CAPTIONS) as RibbonTab[];

describe('Ribbon', () => {
  it('puts Project first, then the everyday work, one Stages tab, what comes out, and Standards at the far end', () => {
    const html = render('sld');
    const order = [...html.matchAll(/id="ribbon-tab-(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['home', 'schedule', 'sld', 'cad', 'sheets', 'spec', 'stages', 'reports', 'cost', 'standards']);
    // Dividers between the kinds of tab, and Standards pushed to the far end.
    expect(html.split('class="tab-sep"').length - 1).toBe(3);
    expect(html).toMatch(/id="ribbon-tab-cost".*?<span class="sp"><\/span><button id="ribbon-tab-standards"/s);
    expect(html).toContain('Add load');
    expect(render('schedule')).toContain('Load schedule');
    expect(render('schedule')).toContain('Add load');
  });

  it('shows the four stages as sub-tabs of Stages, numbered in order, and no others', () => {
    const subTabs = (html: string) => [...(/role="tablist" aria-label="Stages">(.*?)<\/div>/s.exec(html)?.[1] ?? '').matchAll(/id="ribbon-tab-(\w+)"/g)].map((m) => m[1]);
    for (const stage of ['concept', 'schematic', 'detailed', 'issue'] as const) {
      const html = render(stage);
      expect(subTabs(html), stage).toEqual(['concept', 'schematic', 'detailed', 'issue']);
      expect(html, stage).toMatch(/id="ribbon-tab-stages"[^>]*aria-selected="true"/);
      expect(html, stage).toMatch(new RegExp(`id="ribbon-tab-${stage}"[^>]*aria-selected="true"`));
    }
    expect(render('detailed')).toMatch(/>1 Concept<.*>2 Schematic<.*>3 Detailed design<.*>4 Tender and IFC</s);
    for (const tab of ['home', 'schedule', 'sld', 'reports', 'cost', 'standards'] as const) expect(render(tab), tab).not.toContain('ribbon-subtabs');
    expect(render('cad')).not.toContain('aria-label="Stages"'); // Design CAD keeps its own sub-tabs
    expect(render('sld')).toMatch(/id="ribbon-tab-stages"[^>]*aria-selected="false"/);
  });

  it('gives Detailed design only its own tools; the SLD tools and More are on the SLD tab', () => {
    const detailed = render('detailed');
    for (const label of ['Run', 'Selection', 'Voltage drop', 'Earthing', 'Protection', 'Issue detailed']) expect(detailed, label).toContain(`>${label}<`);
    for (const label of ['SLD', 'Sheets', 'Select', 'Pan', 'Boards', 'Board', 'Schedule', 'Enclosure', 'Add load', 'Edit', 'Delete', 'More']) expect(detailed, label).not.toContain(`<span>${label}</span>`);
    expect(detailed).not.toContain('ribbon-selected');
    const sld = render('sld');
    for (const label of ['Run', 'SLD', 'Sheets', 'Select', 'Pan', 'Boards', 'Board', 'Schedule', 'Enclosure', 'Add load', 'Edit', 'Delete', 'More']) expect(sld, label).toContain(`<span>${label}</span>`);
    expect(sld).toContain('ribbon-selected');
  });

  it('captions every group on every tab', () => {
    for (const tab of TABS) {
      const html = render(tab);
      const groups = (html.match(/class="ribbon-group( more)?"/g) ?? []).length;
      const captions = (html.match(/class="ribbon-caption( ribbon-caption-more)?"/g) ?? []).length; // a caption, or its ▾ of more tools
      expect(captions, tab).toBe(groups);
    }
  });

  it('uses icons, not Unicode glyphs, in its chrome', () => {
    for (const tab of TABS) expect(render(tab, { dirty: true, dbIssues: 2 }), tab).not.toMatch(/[▾●⚠✕✓▶]/);
  });

  it('shows unsaved changes and database issues in words', () => {
    expect(render('home', { dirty: true })).toContain('unsaved');
    expect(render('standards', { dbIssues: 2 })).toContain('2 to check');
  });

  it('has ELV systems and the inbox on the Schematic tab, with what is waiting in words', () => {
    const html = render('schematic', { inboxCount: 1 });
    expect(html).toContain('ELV systems');
    expect(html).toContain('1 to review');
    expect(render('schematic')).not.toContain('to review');
  });

  it('marks the current design stage with a badge, separate from the tab selected', () => {
    const html = render('home', { stage: 'schematic' });
    expect(html.split('class="stage-now"').length - 1).toBe(1);
    expect(html).toMatch(/id="ribbon-tab-stages"[^>]*aria-selected="false"[^>]*>.*?class="stage-now"/);
    expect(html).toMatch(/id="ribbon-tab-home"[^>]*aria-selected="true"/);
    // On a stage: on Stages and on the project's stage, whichever stage is showing.
    const other = render('concept', { stage: 'schematic' });
    expect(other.split('class="stage-now"').length - 1).toBe(2);
    expect(other).toMatch(/id="ribbon-tab-schematic"[^>]*aria-selected="false"[^>]*>2 Schematic<span class="stage-now"/);
    expect(other).toMatch(/id="ribbon-tab-concept"[^>]*aria-selected="true"[^>]*>1 Concept<\/button>/);
    // Tender and IFC are one sub-tab.
    for (const stage of ['tender', 'ifc'] as const) expect(render('issue', { stage }), stage).toMatch(/>4 Tender and IFC<span class="stage-now"/);
  });

  it('links the tabs to the tools they show', () => {
    expect(render('home').split('aria-controls="ribbon-tools"').length - 1).toBe(10);
    const html = render('detailed');
    expect(html.split('aria-controls="ribbon-tools"').length - 1).toBe(14); // with the four stages
    expect(html).toContain('id="ribbon-tools"');
    expect(html).toContain('aria-label="3 Detailed design tools"');
  });

  /** Design CAD's actions with a drawing open (or not), every action a no-op. */
  const cad = (over: Partial<NonNullable<RibbonActions['cad']>> = {}) => ({ hasDrawing: true, file: { plans: [], level: 'Ground', levelTitle: '', levels: [], unit: 'mm', unitTitle: '', units: [] }, copyLevels: [], ...over }) as unknown as RibbonActions['cad'];
  const subTabs = (html: string) => [...(/role="tablist" aria-label="Design CAD">(.*?)<\/div>/s.exec(html)?.[1] ?? '').matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);
  const groupsOf = (html: string) => [...html.matchAll(/role="group" aria-label="([^"]+)"/g)].map((m) => m[1]);

  it('opens Design CAD on LVCAD, its panels in the order the user chose, Annotate beside it, with File beside the sub-tabs', () => {
    const html = render('cad', { view: 'cad', cad: cad() });
    expect(subTabs(html)).toEqual(['LVCAD', 'Annotate', 'Electrical, ELV &amp; sheets', 'Output']);
    expect(html).toMatch(/id="ribbon-cad-drafting"[^>]*aria-selected="true"/);
    expect(groupsOf(html)).toEqual(['Draw', 'Modify', 'Blocks', 'Layers', 'Properties', 'Measure and view']);
    // With labels every tool is named and needs about twice the room: the panels take five sub-tabs.
    const all = render('cad', { view: 'cad', cad: cad({ labels: true }) });
    expect(subTabs(all)).toEqual(['LVCAD', 'Annotate', 'Layers &amp; properties', 'Electrical &amp; ELV', 'Sheets', 'Layout', 'Output']);
    expect(groupsOf(all)).toEqual(['Draw', 'Modify', 'Blocks']);
    expect(html).toContain('title="Open, save and close drawings; the level and units of the drawing"'); // File, a menu
    expect(html).toMatch(/aria-haspopup="menu" aria-expanded="false" title="Open, save and close drawings/);
    expect(html).toContain('Show labels');
    expect(render('home')).not.toContain('ribbon-subtabs');
  });

  it('names the main tools under their icons and, on Drafting, the small ones beside theirs; Show labels names them all', () => {
    const shown = render('cad', { view: 'cad', cad: cad() });
    expect(shown).toContain('class="ribbon cad-named small-named"');
    expect(shown).toMatch(/aria-label="Line"[^>]*>.*?<span>Line<\/span>/s); // a main tool: its name under it
    expect(shown).toContain('aria-label="Offset"');
    expect(shown).toContain('<span>Offset</span>'); // a small tool on Drafting: its name beside its icon
    expect(shown).not.toContain('title="Line (L)'); // the tooltip is the app's own, not the browser's
    const all = render('cad', { view: 'cad', cad: cad({ labels: true }) });
    expect(all).toContain('<span>Line</span>');
    expect(all).toContain('<span>Offset</span>');
    expect(all).toContain('title="Line (L): click points');
    expect(all).not.toContain('cad-named');
    expect(all).toMatch(/<label class="ribbon-labels"[^>]*><input type="checkbox"[^>]*checked=""/);
    expect(render('sld')).toContain('<span>Add load</span>'); // the other tabs keep their names
  });

  it('lays Modify out in three rows, column by column, Layers under its current layer list, Match beside its lists', () => {
    const html = render('cad', { view: 'cad', cad: cad({ info: { blocks: [], layers: [{ name: 'E-LIGHTING', color: '#ff0000', on: true, freeze: false, lock: false }], current: 'E-LIGHTING', picked: 0, props: { lw: 0.35 } } }) });
    const panel = (name: string) => new RegExp(`aria-label="${name}"[^>]*>(.*?)</div><(?:div|button) class="ribbon-caption`, 's').exec(html)?.[1] ?? '';
    const cols = (body: string) => [...body.matchAll(/class="ribbon-stack">(.*?)<\/div>/gs)].map((m) => [...m[1].matchAll(/aria-label="([^"]+)"/g)].map((x) => x[1]).filter((n) => !n.endsWith('more options')));
    expect(cols(panel('Modify'))).toEqual([['Move', 'Copy', 'Stretch'], ['Rotate', 'Mirror', 'Scale'], ['Trim', 'Extend', 'Break'], ['Fillet', 'Chamfer', 'Join'], ['Offset', 'Array', 'Explode'], ['Erase']]);
    expect(cols(panel('Layers'))).toEqual([['Off', 'All on'], ['Freeze', 'Thaw all'], ['Lock', 'Unlock'], ['Isolate', 'Unisolate', 'Make current']]);
    expect(panel('Layers')).toMatch(/class="ribbon-layer".*?background:#ff0000.*?<span class="nm">E-LIGHTING<\/span>/s);
    expect(panel('Properties')).toContain('aria-label="Colour of new objects"');
    expect(panel('Properties')).toMatch(/aria-label="Lineweight of new objects"[^>]*>.*?<option value="0.35" selected="">0.35 mm<\/option>/s);
    expect(html).toMatch(/class="ribbon-launch"[^>]*aria-label="Properties palette"/);
    expect(html).toMatch(/class="ribbon-caption ribbon-caption-more" title="More modify tools: Quick select…, Draw order"/);
    expect(html).toMatch(/title="More layers tools: Layer roles, New layer, Layers panel"/);
  });

  it('on the sheets pages shows every sheet tool on the sheets\' sub-tab; with labels, Annotate has the markup', () => {
    const sheets = { tab: 'layout', open: false, onTab: noop } as RibbonActions['sheets'];
    const html = render('cad', { view: 'drawings', cad: cad(), sheets });
    expect(html).toMatch(/id="ribbon-cad-elec"[^>]*aria-selected="true"/);
    expect(groupsOf(html)).toEqual(['Markup', 'On panels', 'Sheet', 'Sheet set']);
    for (const label of ['All sheets', 'Layout', 'Title block', 'Issues']) expect(html, label).toContain(`aria-label="${label}"`);
    // With labels LVCAD has no sheet tools, so a sheets page opens on Sheets (the markup is on Annotate, RibbonDraw.test).
    const all = render('cad', { view: 'drawings', cad: cad({ labels: true }), sheets });
    expect(all).toMatch(/id="ribbon-cad-sheets"[^>]*aria-selected="true"/);
    expect(groupsOf(all)).toEqual(['Sheet', 'Sheet set']); // the sheet's view and the sheet set; Output plot and export
  });

  it('opens the sheets from the SLD tabs', () => {
    for (const tab of ['schematic', 'sld'] as const) expect(render(tab), tab).toContain('(Design CAD → Sheet set)');
  });

  it('gives an icon-only tool a tooltip: its name and command in bold, then what it does', () => {
    expect(tipOf({ label: 'Offset', cmd: 'O', title: 'Offset (O): the distance on the right, click the object' })).toEqual({ head: 'Offset (O)', text: 'The distance on the right, click the object' });
    expect(tipOf({ label: 'Layer palette', cmd: 'LM', title: 'Layer palette (LM), docked beside the drawing' })).toEqual({ head: 'Layer palette (LM)', text: 'Docked beside the drawing' });
    expect(tipOf({ label: 'Erase', cmd: 'E', title: 'Erase the selected object (E or Delete)' })).toEqual({ head: 'Erase (E)', text: 'Erase the selected object (E or Delete)' });
    expect(tipOf({ label: 'Colour', title: 'Colour of new markups', sub: 'Black' })).toEqual({ head: 'Colour · Black', text: 'Colour of new markups' });
  });
});

