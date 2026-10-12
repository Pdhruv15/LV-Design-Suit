import { describe, expect, it } from 'vitest';
import { filterCommands, type Command } from './CommandPalette';

const c = (label: string, group: string, hint?: string): Command => ({ id: `${group}:${label}`, label, group, hint, run: () => {} });
const all = [
  c('Run calculations', 'Commands', 'network studies'),
  c('MDB-1', 'Boards', 'Main distribution board'),
  c('SMDB-GF', 'Boards', 'Ground floor SMDB'),
  c('E-SLD-001', 'Drawing sheets', 'SLD — MDB-1'),
  c('Cable schedule', 'Pages')
];
const labels = (q: string) => filterCommands(all, q).map((x) => x.label);

describe('command palette search', () => {
  it('lists everything for an empty query', () => expect(labels('')).toHaveLength(all.length));
  it('matches the label, the hint or the group, every word', () => {
    expect(labels('ground')).toEqual(['SMDB-GF']);
    expect(labels('cable sched')).toEqual(['Cable schedule']);
    expect(labels('network')).toEqual(['Run calculations']);
    expect(labels('mdb ground')).toEqual(['SMDB-GF']);
    expect(labels('zzz')).toEqual([]);
  });
  it('ranks label prefixes, then label matches, before hint-only matches', () => {
    expect(labels('mdb')).toEqual(['MDB-1', 'SMDB-GF', 'E-SLD-001']);
  });
});
