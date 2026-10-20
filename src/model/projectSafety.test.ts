import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { checkProjectShape, ProjectFileError } from './projectValidate';
import { LIMITS } from './projectSafety';

/** A parsed file: loosely typed, as JSON.parse gives it. */
type Raw = Record<string, unknown> & { boards: Record<string, unknown>[]; feeders: Record<string, unknown>[] };
/** A copy of the sample project as a parsed file would give it, changed by fn. */
const file = (fn: (p: Raw) => void = () => {}) => {
  const p = JSON.parse(JSON.stringify(sampleProject)) as Raw;
  fn(p);
  return p;
};
const refused = (p: unknown) => expect(() => checkProjectShape(p)).toThrow(ProjectFileError);

describe('project files are safe to open', () => {
  it('opens a normal project', () => {
    expect(() => checkProjectShape(file())).not.toThrow();
  });

  it('refuses text in a number field that is drawn', () => {
    refused(file((p) => { p.boards[0].sourceKva = '1000"><script>alert(1)</script>'; }));
    refused(file((p) => { p.feeders[0].cableCsaMm2 = '<img src=x onerror=alert(1)>'; }));
    refused(file((p) => { p.voltageV = '415</text><script>'; }));
  });

  it('still opens a missing or blank number (the To do list reports it)', () => {
    expect(() => checkProjectShape(file((p) => { p.boards[0].sourceKva = null; delete p.feeders[0].cpcMm2; }))).not.toThrow();
  });

  it('refuses earth pit IDs that are not E1, E2 …', () => {
    refused(file((p) => { p.earthPitIds = { 'lv:MDB-1': ['E1', 'E2"><script>alert(1)</script>'] }; }));
    refused(file((p) => { p.earthPitIds = { 'lv:MDB-1': 'E1' }; }));
    expect(() => checkProjectShape(file((p) => { p.earthPitIds = { 'lv:MDB-1': ['E1', 'E2'] }; }))).not.toThrow();
  });

  it('refuses an earthing plan with values of the wrong type', () => {
    refused(file((p) => { p.earthingPlan = { measured: { E1: '0.5"}</style><script>' } }; }));
    refused(file((p) => { p.earthingPlan = { measured: { 'E1"]{}*{background:url(//x)}': 0.5 } }; }));
    refused(file((p) => { p.earthingPlan = { tests: { E1: { by: { evil: 1 } } } }; }));
    refused(file((p) => { p.earthingPlan = { bonding: ['ok', 7] }; }));
    expect(() => checkProjectShape(file((p) => { p.earthingPlan = { measured: { E1: 0.5 }, tests: { E1: { date: '2026-10-01', by: 'PG' } }, bonding: ['Room earth bar'] }; }))).not.toThrow();
  });

  it('refuses reserved keys, deep nesting and huge values', () => {
    refused(JSON.parse(`{"boards":[],"feeders":[],"earthingPlan":{"pits":{"__proto__":{"polluted":1}}}}`));
    refused(file((p) => { Object.defineProperty(p.boards[0], 'constructor', { value: 'x', enumerable: true }); }));
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < LIMITS.depth + 2; i++) { deep.n = {}; deep = deep.n as Record<string, unknown>; }
    refused(file((p) => { p.notes = root; }));
    refused(file((p) => { p.name = 'x'.repeat(LIMITS.stringChars + 1); }));
    refused(file((p) => { p.boards[0].id = 'B'.repeat(LIMITS.idChars + 1); p.feeders.forEach((f) => { f.boardId = p.boards[0].id; }); }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('accepts only a PNG or JPEG logo', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(() => checkProjectShape(file((p) => { p.drawing = { logo: png }; }))).not.toThrow();
    refused(file((p) => { p.drawing = { logo: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+' }; }));
    refused(file((p) => { p.drawing = { logo: 'https://example.com/logo.png' }; }));
    refused(file((p) => { p.drawing = { logo: 'data:image/png;base64,AAAA" onerror="alert(1)' }; }));
  });

  it('refuses markups and title templates with values of the wrong type', () => {
    const sheet = (markups: unknown[]) => ({ sheets: [{ id: 's', number: 'E-SLD-001', title: 'x', kind: 'system', boards: [], size: 'auto', markups }] });
    expect(() => checkProjectShape(file((p) => { p.drawingSet = sheet([{ id: 'm', kind: 'text', x: 1, y: 2, text: '<b>hi</b>' }]); }))).not.toThrow();
    refused(file((p) => { p.drawingSet = sheet([{ id: 'm', kind: 'script', x: 1, y: 2 }]); }));
    refused(file((p) => { p.drawingSet = sheet([{ id: 'm', kind: 'text', x: '1" onmouseover="alert(1)', y: 2 }]); }));
    const tpl = (cell: Record<string, unknown>) => [{ id: 't', name: 'T', cols: [20], rows: [10], cells: [{ id: 'c', r: 0, c: 0, kind: 'text', text: 'x', ...cell }] }];
    expect(() => checkProjectShape(file((p) => { p.titleTemplates = tpl({ align: 'center' }); }))).not.toThrow();
    refused(file((p) => { p.titleTemplates = tpl({ align: 'left;background:url(https://x/)' }); }));
    refused(file((p) => { p.titleTemplates = tpl({ rs: '2"><script>alert(1)</script>' }); }));
  });
});
