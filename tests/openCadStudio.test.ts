import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const bridge = require('../electron/openCadStudio.cjs') as {
  installationCandidates: (platform: string, home: string, env: Record<string, string>) => { kind: string; path: string }[];
  findInstallation: (options: { platform: string; home: string; env: Record<string, string>; existsSync: (path: string) => boolean }) => { kind: string; path: string } | null;
  executableForInstallation: (installation: { kind: string; path: string }, platform: string, exists: (path: string) => boolean) => string;
  safeDxfName: (name: string, index: number) => string;
  validateDxfFiles: (files: { name: string; content: string }[]) => { name: string; content: string }[];
};

describe('OpenCADStudio desktop bridge', () => {
  it('discovers the standard system or user installation on macOS', () => {
    const candidates = bridge.installationCandidates('darwin', '/Users/tester', {});
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      '/Applications/OpenCADStudio.app',
      '/Users/tester/Applications/OpenCADStudio.app'
    ]);
    expect(bridge.findInstallation({
      platform: 'darwin', home: '/Users/tester', env: {},
      existsSync: (candidate) => candidate.startsWith('/Users/tester/')
    })).toEqual({ kind: 'bundle', path: '/Users/tester/Applications/OpenCADStudio.app' });
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
});
