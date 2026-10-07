import { defineConfig } from 'vitest/config';

// Rendered-PDF checks (npm run test:pdf): print the design report through Electron's
// Chromium, like the app does. Kept out of `npm test` — each render starts Electron.
export default defineConfig({ test: { include: ['tests/pdf/**/*.pdf.ts'], testTimeout: 180_000, hookTimeout: 180_000, root: '.' } });
