import { defineConfig } from 'vitest/config';

// Benchmarks only (npm run bench) — kept out of `npm test`.
export default defineConfig({ test: { include: ['tests/performance/**/*.perf.ts'], testTimeout: 3_600_000, root: '.' } });
