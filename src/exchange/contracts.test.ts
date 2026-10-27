// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson, exchangePackage, fixturesPackage, loadsPackage, roomsPackage } from './contracts';

/** contracts/*.schema.json are made from contracts.ts. After changing a contract, run
 *   UPDATE_CONTRACTS=1 npx vitest run src/exchange/contracts.test.ts
 * and commit the files with the change (a new contract version for anything that is not backwards compatible). */
const FILES = { 'exchange-package': exchangePackage, rooms: roomsPackage, fixtures: fixturesPackage, loads: loadsPackage };
const dir = path.resolve(__dirname, '../../contracts');

describe('exchange contracts', () => {
  it.each(Object.entries(FILES))('contracts/%s.schema.json matches contracts.ts', (name, schema) => {
    const text = `${JSON.stringify({ $id: `https://lv-design-studio/contracts/${name}.schema.json`, ...z.toJSONSchema(schema, { io: 'input' }) }, null, 2)}\n`;
    const file = path.join(dir, `${name}.schema.json`);
    if (process.env.UPDATE_CONTRACTS) fs.writeFileSync(file, text);
    expect(fs.readFileSync(file, 'utf-8')).toBe(text);
  });

  it('sorts keys at every depth, so the hash does not depend on key order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 'x' }], u: undefined })).toBe('{"a":[{"c":"x","d":2}],"b":1}');
  });
});
