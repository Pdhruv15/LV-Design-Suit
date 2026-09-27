import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
