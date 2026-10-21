import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const bridge = require('../electron/openCadStudio.cjs') as {
  installationCandidates: (platform: string, home: string, env: Record<string, string>) => { kind: string; path: string }[];
  findInstallation: (options: { platform: string; home: string; env: Record<string, string>; existsSync: (path: string) => boolean }) => { kind: string; path: string } | null;
  executableForInstallation: (installation: { kind: string; path: string }, platform: string, exists: (path: string) => boolean) => string;
  safeDxfName: (name: string, index: number) => string;
  validateDxfFiles: (files: { name: string; content: string }[]) => { name: string; content: string }[];
  copyScripts: (destination: string, source?: string) => string[];
  SCRIPTS_DIR: string;
};

describe('OpenCADStudio desktop bridge', () => {
  it('discovers the standard system or user installation on macOS', () => {
    const candidates = bridge.installationCandidates('darwin', '/Users/user', {});
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      '/Applications/OpenCADStudio.app',
      '/Users/user/Applications/OpenCADStudio.app'
    ]);
    expect(bridge.findInstallation({
      platform: 'darwin', home: '/Users/user', env: {},
      existsSync: (candidate) => candidate.startsWith('/Users/user/')
    })).toEqual({ kind: 'bundle', path: '/Users/user/Applications/OpenCADStudio.app' });
  });

  it('uses the native inner executable for a live macOS automation session', () => {
    const executable = bridge.executableForInstallation(
      { kind: 'bundle', path: '/Applications/OpenCADStudio.app' },
      'darwin',
      (candidate) => candidate.endsWith('/OpenCADStudio-App')
    );
    expect(executable).toBe('/Applications/OpenCADStudio.app/Contents/MacOS/OpenCADStudio-App');
  });

  it('makes supplied drawing names local, safe DXF filenames', () => {
    expect(bridge.safeDxfName('../../MDB:01', 0)).toBe('MDB-01.dxf');
    expect(bridge.safeDxfName('.hidden', 1)).toBe('hidden.dxf');
    expect(bridge.validateDxfFiles([{ name: '../SLD.dxf', content: '0\nSECTION\n' }]))
      .toEqual([{ name: 'SLD.dxf', content: '0\nSECTION\n' }]);
  });

  it('rejects missing or malformed drawing payloads', () => {
    expect(() => bridge.validateDxfFiles([])).toThrow('No DXF drawing');
    expect(() => bridge.validateDxfFiles([{ name: 'bad.dxf', content: 4 } as never])).toThrow('has no text content');
  });

  it('copies the LV scripts for OpenCADStudio into a chosen folder, replacing its own files only', () => {
    expect(readdirSync(bridge.SCRIPTS_DIR).filter((f) => f.endsWith('.py')).sort()).toEqual(['lv_board_check.py', 'lv_room_areas.py', 'lv_summary.py', 'lv_tag_trays.py', 'lv_untag.py']);
    const dest = join(mkdtempSync(join(tmpdir(), 'lvds-scripts-')), 'LV scripts');
    expect(bridge.copyScripts(dest)).toEqual(['README.md', 'lv_board_check.py', 'lv_room_areas.py', 'lv_summary.py', 'lv_tag_trays.py', 'lv_untag.py']);
    writeFileSync(join(dest, 'lv_summary.py'), 'old');
    writeFileSync(join(dest, 'mine.py'), 'keep');
    bridge.copyScripts(dest);
    expect(readFileSync(join(dest, 'lv_summary.py'), 'utf8')).toContain('LV Design Studio — summary');
    expect(readFileSync(join(dest, 'mine.py'), 'utf8')).toBe('keep');
    expect(() => bridge.copyScripts('relative/folder')).toThrow('Choose a folder');
  });

  it('keeps every script inside the OpenCADStudio sandbox: no imports, no file or network access', () => {
    for (const f of readdirSync(bridge.SCRIPTS_DIR).filter((x) => x.endsWith('.py'))) {
      const code = readFileSync(join(bridge.SCRIPTS_DIR, f), 'utf8');
      expect(code, f).not.toMatch(/^\s*(import|from)\s/m);
      expect(code, f).not.toMatch(/\bopen\(|__import__|subprocess|socket/);
    }
  });
});
