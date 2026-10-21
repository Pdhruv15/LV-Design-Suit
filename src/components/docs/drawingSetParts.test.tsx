// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sampleProject } from '../../data/sampleProject';
import { autoSheets, drawable, type DrawingSet } from '../../model/drawingSet';
import { drawingSetPdfParts, type PreparedSheet } from './sheetRender';

// Sheets are drawn by the real renderer in the app (it measures SVG text, which needs a browser); here each sheet's
// page is a stand-in, so the test covers how the set is assembled for Export set and the issue package.
const prepared = async (_p: unknown, set: DrawingSet, _r: unknown, only?: string[]) =>
  set.sheets.filter((s) => drawable(s) && (!only || only.includes(s.id))).map((s) => ({ s, html: `<svg>${s.number}</svg>`, size: s.size ?? 'A3' }) as unknown as PreparedSheet);

describe('drawing set parts for Export set and the issue package', () => {
  it('gives the register first, then every drawable sheet in order, each with its title', async () => {
    const set = { ...autoSheets(sampleProject, 'perMdb'), register: true };
    const p = { ...sampleProject, drawingSet: set };
    const made: string[] = [];
    const toBytes = async ({ html }: { html: string }) => { made.push(html); return new Uint8Array([made.length]); };
    const d = await drawingSetPdfParts(p, set, undefined, toBytes, undefined, true, prepared);
    const sheets = set.sheets.filter(drawable);
    expect(sheets.length).toBeGreaterThan(0);
    expect(d).toMatchObject({ register: true, sheets: sheets.length });
    expect(d.parts).toHaveLength(sheets.length + 1);
    expect(d.titles).toEqual(['Drawing register', ...sheets.map((s) => `${s.number}  ${s.title}`)]);
    expect(made[0]).toMatch(/drawing register/i);
    for (const s of sheets) expect(made.join('')).toContain(s.number);
  });

  it('leaves the register out when the set has none, when sheets are chosen, or when there are no sheets', async () => {
    const toBytes = async () => new Uint8Array([1]);
    const set = { ...autoSheets(sampleProject, 'perMdb'), register: false };
    expect((await drawingSetPdfParts({ ...sampleProject, drawingSet: set }, set, undefined, toBytes, undefined, true, prepared)).titles[0]).not.toBe('Drawing register');
    const withReg = { ...set, register: true };
    const one = withReg.sheets.filter(drawable)[0];
    const chosen = await drawingSetPdfParts({ ...sampleProject, drawingSet: withReg }, withReg, undefined, toBytes, [one.id], undefined, prepared);
    expect(chosen.titles).toEqual([`${one.number}  ${one.title}`]);
    const empty: DrawingSet = { prefix: 'E-SLD-', sheets: [], register: true };
    expect(await drawingSetPdfParts({ ...sampleProject, drawingSet: empty }, empty, undefined, toBytes, undefined, true, prepared)).toEqual({ parts: [], titles: [], sheets: 0, register: false });
  });
});
