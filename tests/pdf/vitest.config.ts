import { defineConfig } from 'vitest/config';

// Rendered-PDF checks (npm run test:pdf): print the design report through Electron's
// Chromium, like the app does. Kept out of `npm test` — each render starts Electron.
// One file at a time: on CI every Electron shares one virtual display (xvfb-run), and
// several starting together could fail to connect to it ("Missing X server or $DISPLAY").
export default defineConfig({ test: { include: ['tests/pdf/**/*.pdf.ts'], testTimeout: 180_000, hookTimeout: 180_000, root: '.', fileParallelism: false } });
