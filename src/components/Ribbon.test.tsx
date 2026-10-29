import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Ribbon, { CAPTIONS, type RibbonActions, type RibbonTab } from './Ribbon';

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
  it('captions every group on every tab', () => {
    for (const tab of TABS) {
      const html = render(tab);
      const groups = (html.match(/class="ribbon-group( more)?"/g) ?? []).length;
      const captions = html.split('class="ribbon-caption"').length - 1;
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

  it('marks the current design stage with a badge, separate from the selected tab', () => {
    const html = render('home', { stage: 'schematic' });
    expect(html.split('class="stage-now"').length - 1).toBe(1);
    expect(html).toMatch(/id="ribbon-tab-schematic"[^>]*aria-selected="false"[^>]*>.*?class="stage-now"/);
    expect(html).toMatch(/id="ribbon-tab-home"[^>]*aria-selected="true"/);
  });

  it('links the tabs to the tools they show', () => {
    const html = render('detailed');
    expect(html.split('aria-controls="ribbon-tools"').length - 1).toBe(TABS.length);
    expect(html).toContain('id="ribbon-tools"');
  });

  it('shows Design CAD as Plan (engineering) and Draw (drafting) over the same drawing', () => {
    const html = render('cad');
    expect(html).toContain('ribbon-subtabs');
    for (const c of ['File', 'Rooms', 'Cables and boards', 'Devices', 'Measure', 'View']) expect(html).toContain(`aria-label="${c}"`);
    for (const c of ['Draw', 'Modify', 'Annotate']) expect(html).not.toContain(`aria-label="${c}"`);
    expect(render('home')).not.toContain('ribbon-subtabs');
  });
});

