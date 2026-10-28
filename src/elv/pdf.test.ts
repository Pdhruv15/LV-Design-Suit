import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { elvTables, withRemark } from './outputs';
import { elvSchedulesHtml } from './pdf';
import { placeDevices } from './placed';

const box = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const project = (): Project => placeDevices({
  name: 'Tower <A>', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: {
    buildings: [{ id: 'T', name: 'Tower', levels: [{ id: 'L1', name: 'Typical', kind: 'typical', heightM: 3.5, count: 3 }] }],
    rooms: [{ id: 'R1', buildingId: 'T', levelId: 'L1', name: 'Office', type: 'office', areaM2: 200, outline: box(0, 0, 20, 10) }]
  }
}, 'T', 'L1', [{ type: 'smoke-detector', x: 5, y: 5 }, { type: 'sounder-beacon', x: 10, y: 9 }]).project;

describe('ELV schedules PDF', () => {
  it('prints each schedule with rows on its own pages, remarks in the last column, black and white', () => {
    const p = withRemark(project(), 'devices', 'R1', 'Ceiling void > 800 mm');
    const html = elvSchedulesHtml(p, elvTables(p), 'REV A · 2026-10-28');
    const sections = html.match(/<section>/g) ?? [];
    const titles = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(titles).toEqual(['ELV device schedule', 'Fire alarm loop schedule', 'Fire detection zones', 'ELV bill of quantities']);
    expect(sections).toHaveLength(titles.length);
    expect(html).toContain('section + section { break-before: page; }');
    expect(html).toContain('<td class="remark">Ceiling void &gt; 800 mm</td>');
    expect(html).toContain('Tower &lt;A&gt; · REV A · 2026-10-28');
    expect(html).toContain('Typical (L01–L03)');
    // No colour: only black, greys and white.
    const colours = new Set((html.match(/#[0-9a-f]{3,6}\b/gi) ?? []).map((c) => c.toLowerCase()));
    for (const c of colours) expect(['#000', '#444', '#999', '#f2f2f2', '#fff'], c).toContain(c);
  });
});
