import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

/** The `lvds` command (CLI, MCP server, local API) as one Node file: dist-cli/lvds.mjs.
 * Uses the app's own calculation code (src/calc, src/model); no React, no Electron. */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version.split('.').slice(0, 2).join('.')) },
  publicDir: false,
  build: {
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    ssr: 'src/headless/main.ts',
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { entryFileNames: 'lvds.mjs', banner: '#!/usr/bin/env node', codeSplitting: false }
    }
  },
  // Bundle the dependencies into the one file, so it runs without node_modules.
  ssr: { noExternal: true, target: 'node' }
});
