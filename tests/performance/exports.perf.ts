import { it } from 'vitest';
import { projectWithCircuits } from '../fixtures/largeProject';
import { buildDbSheet } from '../../src/docs/dbSheet';
import { buildFormWorkbook, workbookBytes } from '../../src/docs/formWorkbook';

it('500+ circuit Excel export benchmark', async () => {
  const project = projectWithCircuits(510);
  const started = performance.now();
  const sheet = buildDbSheet(project, 'DB-GF1');
  const built = performance.now();
  const bytes = await workbookBytes(buildFormWorkbook(project, { boardIds: ['DB-GF1'], forms: ['db'] }));
  const written = performance.now();
  process.stdout.write(`\n510 circuits: model ${(built - started).toFixed(1)} ms · XLSX ${(written - built).toFixed(1)} ms · ${(bytes.byteLength / 1024).toFixed(1)} KB\n`);
  if (sheet.rows.filter((row) => row.type === 'circuit').length !== 510) throw new Error('Large export lost circuits');
});
