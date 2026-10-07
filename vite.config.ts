import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';

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
  "form-action 'none'",
  "manifest-src 'self'"
].join('; ');
const csp = (): Plugin => ({
  name: 'lvds-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n<meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
});

/** Install as an app (web version): the app manifest, and a service worker
 * that keeps every file of this build for offline use. The file list is
 * written at build time, so the first visit prepares everything (including
 * the PDF / Excel libraries loaded later) and the page can say "Ready for
 * offline use" only when that worked. Not used by the desktop app. */
const pwa = (): Plugin => ({
  name: 'lvds-pwa',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<title>', '<link rel="manifest" href="manifest.webmanifest" />\n<meta name="theme-color" content="#0f1b33" />\n<link rel="icon" href="icon.svg" />\n<link rel="apple-touch-icon" href="icon-192.png" />\n<title>'),
  generateBundle(_opts, bundle) {
    const files = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', ...Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js')];
    const version = createHash('sha1').update(files.join('|')).digest('hex').slice(0, 10);
    this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify({
      name: 'LV Design Studio', short_name: 'LV Design', description: 'Low-voltage power design: SLD, calculations, schedules and reports',
      start_url: './', scope: './', display: 'standalone', background_color: '#0b1220', theme_color: '#0f1b33',
      icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }]
    }, null, 2) });
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: `// LV Design Studio — offline copy of build ${version}
const CACHE = 'lvds-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('lvds-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  // Pages: the network first (gets updates), the offline copy when there is none.
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match('index.html'))); return; }
  e.respondWith(caches.match(r).then((hit) => hit || fetch(r)));
});
self.addEventListener('message', (e) => { if (e.data === 'version') e.source.postMessage({ version: '${version}', files: FILES.length }); });
` });
  }
});

import pkg from './package.json';

export default defineConfig({
  // App version shown in the title and header: v1.2 (major.minor of package.json).
  define: { __APP_VERSION__: JSON.stringify(pkg.version.split('.').slice(0, 2).join('.')) },
  plugins: [react(), csp(), pwa()],
  resolve: {
    // ExcelJS's browser build: the app writes .xlsx files in the page (the
    // Node build needs Node streams).
    alias: [{ find: /^exceljs$/, replacement: 'exceljs/dist/exceljs.min.js' }]
  },
  base: './',
  build: {
    outDir: 'dist',
    // Views, report and export code load when opened (React.lazy, import()). Two chunks stay near
    // 940 kB: ExcelJS (one library, loaded only for an Excel export) and the core SLD workspace
    // needed at start. Anything new above 1 MB still warns.
    chunkSizeWarningLimit: 1000
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
