import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Dependency overrides are time-bounded (docs/engineering/dependency-overrides.md): this fails after the
 * review date, and when the overrides and that page drift apart. */
const REVIEW_BY = '2027-01-17';
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { overrides?: Record<string, unknown> };
const doc = readFileSync(new URL('../../docs/engineering/dependency-overrides.md', import.meta.url), 'utf8');

describe('dependency overrides', () => {
  it('are reviewed before their expiry date', () => {
    expect(doc).toContain(`Review by: **${REVIEW_BY}**`);
    const today = new Date().toISOString().slice(0, 10);
    expect(today <= REVIEW_BY, `Dependency overrides were due for review on ${REVIEW_BY}: see docs/engineering/dependency-overrides.md`).toBe(true);
  });

  it('match what the page documents', () => {
    expect(pkg.overrides).toEqual({ 'shell-quote': '1.11.0', exceljs: { uuid: '11.1.1' }, '@electron/get': { 'global-agent': '4.1.3' } });
    for (const pin of ['`uuid` **11.1.1**', '`global-agent` **4.1.3**', '`shell-quote` **1.11.0**']) expect(doc).toContain(pin);
  });
});
