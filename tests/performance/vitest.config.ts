import { defineConfig } from 'vitest/config';

// Benchmarks only (npm run bench) — kept out of `npm test`.
// The built-in DWG / DXF reader's WebAssembly is inlined where it is imported.
export default defineConfig({ assetsInclude: ['**/*.wasm'], test: { include: ['tests/performance/**/*.perf.ts'], testTimeout: 3_600_000, root: '.' } });
