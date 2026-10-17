import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

type Fn = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const require = createRequire(import.meta.url);
const L = require('../../electron/limits.cjs') as { LIMITS: Record<string, number>; LimitError: new () => Error } & Record<'readTextFileLimited' | 'readJsonLimited' | 'assertFileWithin' | 'assertTextWithin' | 'assertJsonWithin' | 'boundedCollector', Fn>;
const V = require('../../electron/ipcValidate.cjs') as Record<'workbookRows' | 'projectSaveArgs' | 'libraryData' | 'engineRequest' | 'recoveryArgs', Fn>;
const DB = require('../../electron/database.cjs') as { setFolder: (d: string | null) => void; writeBook: Fn; spec: { books: { id: string }[] } };
const { runJsonProcess } = require('../../electron/engineRunner.cjs') as { runJsonProcess: (o: Record<string, unknown>) => Promise<Record<string, unknown>> };

const dir = mkdtempSync(join(tmpdir(), 'lvds-limits-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('reading files within a limit', () => {
  it('reads a file at the limit and refuses one byte more, before reading it', () => {
    const f = join(dir, 'p.json');
    writeFileSync(f, '{"a":"' + 'x'.repeat(92) + '"}'); // 100 bytes
    expect(L.readJsonLimited(f, 100, 'p.json')).toEqual({ a: 'x'.repeat(92) });
    expect(() => L.readTextFileLimited(f, 99, 'p.json')).toThrow(/p\.json is too large/);
    expect(() => L.assertFileWithin(f, 99, 'p.json')).toThrow(L.LimitError);
    mkdirSync(join(dir, 'folder.json'));
    expect(() => L.readTextFileLimited(join(dir, 'folder.json'), 100)).toThrow(/not a file/);
  });
});

describe('payload limits', () => {
  it('checks text size in UTF-8 bytes', () => {
    expect(() => L.assertTextWithin('ab', 2, 'x')).not.toThrow();
    expect(() => L.assertTextWithin('é', 1, 'x')).toThrow(/too large/); // 2 bytes
  });

  it('refuses very deep nesting without overflowing the stack', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 100_000; i++) { deep.n = {}; deep = deep.n as Record<string, unknown>; }
    expect(() => L.assertJsonWithin(root, 1e9, 'The project')).toThrow(/nested too deeply/);
    expect(() => V.projectSaveArgs({ data: { boards: [], feeders: [], x: root } })).toThrow(/nested too deeply/);
    expect(() => V.libraryData({ x: root })).toThrow(/nested too deeply/);
    expect(() => V.engineRequest({ engine: 'pandapower', project: { x: root } })).toThrow(/nested too deeply/);
  });

  it('refuses values that are not plain data and sizes over the limit', () => {
    expect(() => L.assertJsonWithin({ n: 1n }, 1e6, 'x')).toThrow(/not plain data/);
    expect(() => L.assertJsonWithin({ s: 'x'.repeat(50) }, 40, 'The library')).toThrow(/The library is too large/);
  });

  it('caps workbook writes at 2,000 rows of plain values', () => {
    const row = { id: 'x', kva: 1000 };
    expect(V.workbookRows('transformers', Array(L.LIMITS.workbookRows).fill(row))).toHaveLength(2000);
    expect(() => V.workbookRows('transformers', Array(L.LIMITS.workbookRows + 1).fill(row))).toThrow(/2001 rows for transformers \(at most 2000\)/);
    expect(() => V.workbookRows('transformers', [{ id: { nested: true } }])).toThrow(/not text or a number/);
    expect(() => V.workbookRows('transformers', [{ id: 'x'.repeat(L.LIMITS.workbookCellChars + 1) }])).toThrow(/longer than/);
    expect(() => V.workbookRows('transformers', [JSON.parse('{"__proto__":{"x":1}}')])).toThrow(/field name/);
    expect(() => V.workbookRows('transformers', [Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 1]))])).toThrow(/101 fields/);
    expect(() => V.workbookRows('transformers', [{ kva: Infinity }])).toThrow(/not text or a number/);
  });
});

describe('database writes', () => {
  it('refuses more than 2,000 rows before creating or backing up any file', async () => {
    const db = join(dir, 'db');
    DB.setFolder(db);
    try {
      await expect(DB.writeBook(dir, DB.spec.books[0].id, Array(2001).fill({}))).rejects.toThrow(/at most 2000 rows/);
      expect(() => readdirSync(db)).toThrow(); // folder never created
    } finally { DB.setFolder(null); }
  });
});

describe('collecting child output within a limit', () => {
  it('stops at the limit once, or keeps only the tail', () => {
    let overflows = 0;
    const head = L.boundedCollector(5, () => overflows++);
    head.push('abc'); head.push('def'); head.push('ghi');
    expect(head.text()).toBe('abc');
    expect(overflows).toBe(1);
    const tail = L.boundedCollector(5, () => {}, true);
    tail.push('abc'); tail.push('defgh'); tail.push('ijklmnop');
    expect(tail.text()).toBe('lmnop');
  });
});

/** Runs a Node one-liner as the "engine". */
const run = (code: string, extra: Record<string, unknown> = {}) => {
  let child: ChildProcess | undefined;
  const p = runJsonProcess({ command: process.execPath, args: ['-e', code], input: { engine: 'probe' }, what: 'Engine', onSpawn: (c: ChildProcess) => { child = c; }, ...extra });
  return { p, child: () => child! };
};
const gone = async (c: ChildProcess) => {
  for (let i = 0; i < 50 && c.exitCode === null && c.signalCode === null; i++) await new Promise((r) => setTimeout(r, 50));
  return c.exitCode !== null || c.signalCode !== null;
};

describe('engine runs', () => {
  it('returns the JSON answer', async () => {
    const { p } = run("let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify({ok:true,got:JSON.parse(s).engine})))");
    expect(await p).toEqual({ ok: true, got: 'probe' });
  });

  it('stops a run whose output passes the limit, and kills it', async () => {
    const { p, child } = run("const b='x'.repeat(65536);(function w(){while(process.stdout.write(b));process.stdout.once('drain',w)})()", { stdoutBytes: 100_000 });
    expect((await p).error).toMatch(/Engine output is too large/);
    expect(await gone(child())).toBe(true);
  });

  it('times out once and kills a run that ignores SIGTERM', async () => {
    const { p, child } = run("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)", { timeoutMs: 300, killGraceMs: 200 });
    expect(await p).toEqual({ error: 'Engine timed out after 0.3 s' });
    expect(await gone(child())).toBe(true);
    expect(child().signalCode).toBe('SIGKILL');
  });

  it('reports a failed run with the end of its error output only', async () => {
    const { p } = run("process.exitCode=3;process.stderr.write('noise\\n'.repeat(20000)+'last line')", { stderrBytes: 1000 });
    const r = await p;
    expect(r.error).toMatch(/^Engine exited with code 3\. .*last line$/);
    expect(String(r.error).length).toBeLessThan(200);
  });

  it('settles once when the program cannot start', async () => {
    const p = runJsonProcess({ command: join(dir, 'no-such-python'), input: {}, startError: (m: string) => `Could not start Python: ${m}` });
    expect((await p).error).toMatch(/^Could not start Python: .*ENOENT/);
  });
});
