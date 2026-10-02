import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Content Security Policy for the built app (not the dev server, whose hot
 * reload needs inline scripts): only the app's own code runs; no remote
 * content is loaded. Inline styles are allowed (React style props and the
 * printed sheets' own <style>). */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob: data: about:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');
const csp = (): Plugin => ({
  name: 'lvds-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n<meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
});

export default defineConfig({
  plugins: [react(), csp()],
  resolve: {
    // ExcelJS's browser build: the app writes .xlsx files in the page (the
    // Node build needs Node streams).
    alias: [{ find: /^exceljs$/, replacement: 'exceljs/dist/exceljs.min.js' }]
  },
  base: './',
  build: {
    outDir: 'dist'
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
