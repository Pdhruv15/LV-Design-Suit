import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, posix, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without type declarations
import { asarFiles, LOCALE_FILES, MAC_LANGUAGES, MAX_ASAR_MB, packageProblems } from '../scripts/check-package.mjs';

// What the installed app carries. electron-builder adds production dependencies to the package unless told
// not to, although they are all compiled into dist and dist-electron. CI lists a real package with
// scripts/check-package.mjs; these tests check the settings and what they rely on.
const root = resolve(__dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  overrides: { exceljs: { uuid: string } };
  build: { files: string[]; electronLanguages: string[] };
};

describe('package filter', () => {
  it('carries only the built app and the main process, without node_modules', () => {
    expect(pkg.build.files.filter((f) => !f.startsWith('!'))).toEqual(['dist/**/*', 'dist-electron/**/*', 'electron/**/*']);
    expect(pkg.build.files).toContain('!node_modules/**/*');
  });

  it('carries the CAD engine once: the window gets it from electron/cad, the web version from dist/assets', () => {
    expect(pkg.build.files).toContain('!dist/assets/lvds_cad_reader_bg-*.wasm');
    expect(existsSync(join(root, 'electron/cad/lvds_cad_reader_bg.wasm'))).toBe(true);
    expect(read('electron/cadFile.cjs')).toContain("path.join(CAD_DIR, 'lvds_cad_reader_bg.wasm')");
    expect(read('src/engines/cad/cadEngine.ts')).toContain('window.lvds?.cadFile?.engine');
  });

  it('keeps English on every system: Mac folders are en, en_GB; Windows and Linux files are en-US, en-GB', () => {
    // Names are matched exactly: "en" alone would delete en-US.pak, the file Chromium falls back to on Windows and Linux.
    expect(pkg.build.electronLanguages).toEqual(['en', 'en_GB', 'en-US', 'en-GB']);
  });

  it('builds the file the main process loads, and keeps the licence texts that node_modules used to carry', () => {
    expect(pkg.scripts.build).toContain('vite build -c vite.electron.config.ts');
    expect(read('vite.electron.config.ts')).toContain("outDir: 'dist-electron'");
    expect(read('vite.electron.config.ts')).toContain("entryFileNames: 'exceljs.cjs'");
    for (const config of ['vite.config.ts', 'vite.electron.config.ts']) expect(read(config), config).toContain("license: { fileName: 'third-party-licences.md' }");
  });

  it('keeps the compiled libraries in dependencies, so the audit of what ships (scripts/check-audit.mjs) still covers them', () => {
    for (const lib of ['docx', 'dompurify', 'exceljs', 'jszip', 'lucide-react', 'pdf-lib', 'react', 'react-dom', 'zod']) expect(pkg.dependencies, lib).toHaveProperty(lib);
  });
});

describe('what the main process may load', () => {
  // electron/*.cjs and the CAD reader's glue run from the package as they are, so a package they load would be missing there.
  const files = (readdirSync(join(root, 'electron'), { recursive: true }) as string[]).map((f) => f.split(sep).join('/')).filter((f) => /\.c?js$/.test(f));
  const code = (file: string) => read(`electron/${file}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const loads = (file: string) => [...code(file).matchAll(/\b(?:require|import)\(\s*(.+?)\s*[,)]/g)].map((m) => m[1]);
  const literal = (spec: string) => /^'([^']+)'$/.exec(spec)?.[1];
  const builtin = (name: string) => name === 'electron' || name.startsWith('node:') || builtinModules.includes(name);

  it('finds the files', () => {
    expect(files).toEqual(expect.arrayContaining(['main.cjs', 'database.cjs', 'preload.cjs', 'cad/lvds_cad_reader.js']));
    expect(loads('database.cjs')).toContain("'./limits.cjs'");
  });

  it('needs no package but ExcelJS, and that only before a build', () => {
    const packages = files.flatMap((f) => loads(f).map(literal).filter((n): n is string => !!n && !n.startsWith('.') && !builtin(n)).map((n) => `${f}: ${n}`));
    expect(packages).toEqual(['database.cjs: exceljs']);
    // The bundled file comes first: the installed library is what a package does not have.
    expect(code('database.cjs')).toContain("fs.existsSync(EXCELJS_BUNDLE) ? require('../dist-electron/exceljs.cjs') : require('exceljs')");
  });

  it('loads its own files from what the package carries', () => {
    const own = files.flatMap((f) => loads(f).map(literal).filter((n): n is string => !!n && n.startsWith('.')).map((n) => posix.join(posix.dirname(`electron/${f}`), n)));
    expect(own.length).toBeGreaterThan(10);
    for (const f of own) {
      if (f === 'dist-electron/exceljs.cjs') continue; // built by vite.electron.config.ts
      expect(f.startsWith('electron/') && existsSync(join(root, f)), f).toBe(true);
    }
  });

  it('loads nothing by a computed name, which the tests above could not see', () => {
    const computed = files.flatMap((f) => loads(f).filter((s) => !literal(s)).map((s) => `${f}: ${s}`));
    expect(computed).toEqual(['cadFile.cjs: `${pathToFileURL(path.join(CAD_DIR']); // the reader in electron/cad
  });
});

describe('ExcelJS for the main process', () => {
  it('imports and exports a database workbook from the layout of the package, with no node_modules to fall back on', () => {
    const app = mkdtempSync(join(tmpdir(), 'lvds-package-'));
    try {
      execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '-c', 'vite.electron.config.ts', '--outDir', join(app, 'dist-electron'), '--logLevel', 'error'], { cwd: root, env: { ...process.env, NODE_ENV: 'production' } });
      cpSync(join(root, 'electron'), join(app, 'electron'), { recursive: true });
      writeFileSync(join(app, 'check.cjs'), `
        const database = require('./electron/database.cjs');
        const exceljs = () => Object.keys(require.cache).filter((k) => k.includes('exceljs') || k.includes('node_modules'));
        (async () => {
          const atStart = exceljs();
          const { created } = await database.ensureDatabase(__dirname);
          await database.writeBook(__dirname, 'busbar', [{ material: 'Cu', ratingA: 800, rMohmPerM: 0.08, xMohmPerM: 0.02 }]);
          const read = await database.readDatabase(__dirname);
          console.log(JSON.stringify({ atStart, created: created.length, ratingA: read.books.busbar.rows[0].ratingA, loaded: exceljs().map((k) => k.slice(__dirname.length + 1)) }));
        })().catch((e) => { console.error(e); process.exit(1); });
      `);
      // Outside the repository, with no NODE_PATH: a library left out of the file cannot be found.
      const out = JSON.parse(execFileSync(process.execPath, ['check.cjs'], { cwd: app, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } }));
      expect(out.atStart).toEqual([]);
      expect(out.created).toBeGreaterThan(5);
      expect(out.ratingA).toBe(800);
      expect(out.loaded).toEqual([join('dist-electron', 'exceljs.cjs')]);
      expect(readdirSync(join(app, 'dist-electron')).sort()).toEqual(['exceljs.cjs', 'third-party-licences.md']);
      const licences = readFileSync(join(app, 'dist-electron/third-party-licences.md'), 'utf8');
      expect(licences).toContain('## exceljs - ');
      // docs/engineering/dependency-overrides.md: the main process gets the overridden uuid.
      expect(licences).toContain(`## uuid - ${pkg.overrides.exceljs.uuid} `);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('scripts/check-package.mjs', () => {
  const clean = () => ({
    files: ['package.json', 'dist/index.html', 'dist/third-party-licences.md', 'dist/assets/index-abc.js', 'dist-electron/exceljs.cjs', 'dist-electron/third-party-licences.md', 'electron/main.cjs', 'electron/cad/lvds_cad_reader_bg.wasm'],
    asarMb: 11.6,
    languages: { locales: { found: ['en-US.pak', 'en-GB.pak'], expected: LOCALE_FILES }, framework: { found: ['en_GB.lproj', 'en.lproj'], expected: MAC_LANGUAGES } }
  });
  const problems = (change: (p: ReturnType<typeof clean>) => void) => {
    const p = clean();
    change(p);
    return packageProblems(p).join('\n');
  };

  it('passes a package holding what the app runs', () => {
    expect(packageProblems(clean())).toEqual([]);
  });

  it('finds node_modules, at any depth', () => {
    expect(problems((p) => p.files.push('node_modules/exceljs/excel.js'))).toContain('node_modules is back');
    expect(problems((p) => p.files.push('electron/node_modules/a/index.js'))).toContain('node_modules is back');
  });

  it('finds a second CAD engine', () => {
    expect(problems((p) => p.files.push('dist/assets/lvds_cad_reader_bg-abc.wasm'))).toContain('dist/assets/lvds_cad_reader_bg-abc.wasm');
  });

  it('finds a missing file the app needs', () => {
    expect(problems((p) => { p.files = p.files.filter((f) => f !== 'dist-electron/exceljs.cjs'); })).toContain('dist-electron/exceljs.cjs is missing');
    expect(problems((p) => { p.files = p.files.filter((f) => f !== 'electron/cad/lvds_cad_reader_bg.wasm'); })).toContain('lvds_cad_reader_bg.wasm is missing');
    expect(problems((p) => { p.files = p.files.filter((f) => f !== 'dist/third-party-licences.md'); })).toContain('dist/third-party-licences.md is missing');
  });

  it('finds other languages back, and the English file gone', () => {
    expect(problems((p) => p.languages.locales.found.push('de.pak'))).toContain('locales should hold only en-GB.pak, en-US.pak');
    expect(problems((p) => { p.languages.locales.found = []; })).toContain('holds 0 files');
    expect(problems((p) => p.languages.framework.found.push('en_FEMININE.lproj'))).toContain('framework should hold only');
  });

  it('finds an app.asar that has grown', () => {
    expect(problems((p) => { p.asarMb = MAX_ASAR_MB + 1; })).toContain('above the');
  });

  it('reads the file list from the header of an app.asar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lvds-asar-'));
    try {
      const json = Buffer.from(JSON.stringify({ files: { 'package.json': { size: 1, offset: '0' }, electron: { files: { 'main.cjs': { size: 1, offset: '1' }, cad: { files: { 'a.wasm': { size: 1, offset: '2' } } } } } } }));
      const head = Buffer.alloc(16);
      head.writeUInt32LE(4, 0);
      head.writeUInt32LE(json.length + 8, 4);
      head.writeUInt32LE(json.length + 4, 8);
      head.writeUInt32LE(json.length, 12);
      writeFileSync(join(dir, 'app.asar'), Buffer.concat([head, json]));
      expect(asarFiles(join(dir, 'app.asar'))).toEqual(['package.json', 'electron/main.cjs', 'electron/cad/a.wasm']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
