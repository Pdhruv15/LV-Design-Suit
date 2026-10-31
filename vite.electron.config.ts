import { defineConfig } from 'vite';
import { builtinModules, createRequire } from 'node:module';

/** ExcelJS for the Electron main process as one Node file: dist-electron/exceljs.cjs. The package has no
 * node_modules, so electron/database.cjs loads this file. The window has its own browser build (vite.config.ts). */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-electron',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    ssr: createRequire(import.meta.url).resolve('exceljs'),
    // The licence texts of the libraries in the file: the package has no node_modules to carry them (NOTICE.md).
    license: { fileName: 'third-party-licences.md' },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { format: 'cjs', entryFileNames: 'exceljs.cjs', codeSplitting: false }
    }
  },
  // Bundle the dependencies into the one file, so it runs without node_modules.
  ssr: { noExternal: true, target: 'node' }
});
