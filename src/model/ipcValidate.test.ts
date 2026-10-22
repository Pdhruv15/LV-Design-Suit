import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { exportDss } from '../engines/opendss/exportDss';
import { EMPTY_BYTES } from '../../tests/fixtures/importExport';

type Fn = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
type V = Record<'defaultFileName' | 'fileFilter' | 'saveTextArgs' | 'saveBinaryArgs' | 'pdfArgs' | 'projectSaveArgs' | 'recoveryArgs' | 'workbookRows' | 'libraryData' | 'engineRequest', Fn> & { ALLOWED_PERMISSIONS: Set<string> };
const check = createRequire(import.meta.url)('../../electron/ipcValidate.cjs') as V;

describe('IPC payload checks (electron/ipcValidate.cjs)', () => {
  it('default file names keep only the last path part', () => {
    expect(check.defaultFileName('report.pdf')).toBe('report.pdf');
    expect(check.defaultFileName('../../etc/passwd')).toBe('passwd');
    expect(check.defaultFileName('C:\\Users\\x\\a.xlsx')).toBe('a.xlsx');
    expect(check.defaultFileName('..')).toBe('export');
    expect(check.defaultFileName(42)).toBe('export');
  });

  it('text and binary exports: content of the right type and plain extensions', () => {
    expect(check.saveTextArgs({ defaultName: 'a.dss', content: 'x', filterName: 'OpenDSS script', extensions: ['dss'] }).filter).toEqual({ name: 'OpenDSS script', extensions: ['dss'] });
    expect(() => check.saveTextArgs({ defaultName: 'a', content: 5, extensions: ['txt'] })).toThrow('Refused');
    expect(() => check.saveTextArgs({ defaultName: 'a', content: 'x', extensions: ['../sh'] })).toThrow('file type list');
    expect(() => check.saveTextArgs({ defaultName: 'a', content: 'x', extensions: [] })).toThrow('file type list');
    const b = check.saveBinaryArgs({ defaultName: 'a.xlsx', bytes: new Uint8Array([1, 2, 3]).subarray(1), filterName: 'Excel', extensions: ['xlsx'] });
    expect([...b.bytes]).toEqual([2, 3]);
    expect(() => check.saveBinaryArgs({ defaultName: 'a', bytes: 'text', extensions: ['xlsx'] })).toThrow('without bytes');
    expect(() => check.saveBinaryArgs({ defaultName: 'a.xlsx', bytes: EMPTY_BYTES, extensions: ['xlsx'] })).toThrow('empty binary export');
  });

  it('PDF options: HTML text, a known sheet size, defaults as before', () => {
    expect(check.pdfArgs({ html: '<p/>' })).toEqual({ defaultName: 'report.pdf', html: '<p/>', pageSize: 'A4', landscape: true, cssPages: false });
    expect(() => check.pdfArgs({ html: '  ', pageSize: 'A1', landscape: false, cssPages: true })).toThrow('without HTML');
    expect(() => check.pdfArgs({ html: '<p/>', pageSize: { width: 1e9 } })).toThrow('sheet size');
    expect(() => check.pdfArgs({ html: 1 })).toThrow('without HTML');
  });

  it('project save, recovery, workbook, library and engine payloads', () => {
    expect(check.projectSaveArgs({ data: { boards: [], feeders: [] }, force: 'yes' }).force).toBe(false);
    expect(() => check.projectSaveArgs({ file: 'a.json', data: { boards: [] } })).toThrow('not a project');
    expect(() => check.projectSaveArgs({ file: ['a'], data: { boards: [], feeders: [] } })).toThrow('project file name');
    expect(() => check.recoveryArgs({ projectId: 'x' })).toThrow('recovery');
    expect(() => check.workbookRows('cables', [{ a: 1 }, 'x'])).toThrow('rows for cables');
    expect(() => check.libraryData([1])).toThrow('library');
    expect(check.engineRequest({ engine: 'probe' })).toEqual({ engine: 'probe' });
    expect(() => check.engineRequest({ engine: 'shell' })).toThrow('unknown calculation engine');
    expect(() => check.engineRequest({ engine: 'opendss', project: {} })).toThrow('without a script');
  });

  it('only the clipboard-write permission is granted', () => {
    expect([...check.ALLOWED_PERMISSIONS]).toEqual(['clipboard-sanitized-write']);
  });
});

// The Python engine's OpenDSS command allow-list, run with the real interpreter when there is one.
const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);
describe.skipIf(!python)('OpenDSS script allow-list (engines/python/lvds_engine.py)', () => {
  const lines = (script: string) => {
    const code = 'import sys, json; sys.path.insert(0, "engines/python"); from lvds_engine import check_dss_line\nout = []\nfor l in json.load(sys.stdin):\n    try:\n        check_dss_line(l); out.append("ok")\n    except ValueError as e:\n        out.append(str(e))\nprint(json.dumps(out))';
    const r = spawnSync(python!, ['-I', '-c', code], { input: JSON.stringify(script.split('\n')), encoding: 'utf8', cwd: process.cwd() });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout) as string[];
  };

  it("accepts every command the app's own export runs", () => {
    const run = exportDss(sampleProject).script.split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('!') && !l.toLowerCase().startsWith('show') && !l.toLowerCase().includes('mode=faultstudy'));
    expect(run.length).toBeGreaterThan(10);
    expect(lines(run.join('\n')).filter((x) => x !== 'ok')).toEqual([]);
  });

  it('refuses commands that read or write files or run programs', () => {
    expect(lines(['DOScmd calc.exe', 'Redirect C:\\x.dss', 'Compile x.dss', 'Export voltages', 'Save circuit', 'CD /tmp', 'Set datapath=/tmp', 'Set editor=sh'].join('\n'))).toEqual([
      "OpenDSS command not allowed: DOScmd", 'OpenDSS command not allowed: Redirect', 'OpenDSS command not allowed: Compile',
      'OpenDSS command not allowed: Export', 'OpenDSS command not allowed: Save', 'OpenDSS command not allowed: CD',
      'OpenDSS option not allowed: Set datapath', 'OpenDSS option not allowed: Set editor'
    ]);
  });
});
