import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleProject } from '../../data/sampleProject';
import { estimateElv } from '../../elv/estimate';
import { elvLoadsPackage } from '../../elv/package';
import { placeElvLoads } from '../../elv/place';
import { decide, exchangeOf } from '../../exchange/inbox';
import type { Project } from '../../types';
import { sha256Hex } from '../../util/sha256';
import ElvView from './ElvView';
import InboxView from './InboxView';

const noop = () => {};
const villa: Project = {
  ...sampleProject, id: 'proj-villa',
  building: {
    buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }] }],
    rooms: [{ id: 'R1', buildingId: 'V', levelId: 'GF', name: 'Majlis', type: 'living', areaM2: 40 }, { id: 'R2', buildingId: 'V', levelId: 'GF', name: 'Office', type: 'office', areaM2: 24 }]
  }
};
const pkgOf = (p: Project) => elvLoadsPackage(p, estimateElv(p), '2026-10-27T08:00:00.000Z', sha256Hex);

describe('ELV screens', () => {
  it('ELV systems shows the five systems, the total and every supply', () => {
    const html = renderToStaticMarkup(<ElvView project={villa} onChange={noop} onSend={noop} onPlace={noop} onStatus={noop} />);
    for (const s of ['Fire alarm', 'CCTV', 'Access control', 'ICT', 'Public address', 'Total upstream', 'Send to LV']) expect(html).toContain(s);
    for (const s of estimateElv(villa).supplies) expect(html).toContain(s.id);
    expect(html).not.toContain('Place on boards'); // nothing accepted yet
  });

  it('a system switched off in the project is shown off and not estimated', () => {
    const html = renderToStaticMarkup(<ElvView project={{ ...villa, elv: { systems: ['ict'] } }} onChange={noop} onSend={noop} onPlace={noop} onStatus={noop} />);
    expect(html).toContain('Off');
    expect(html).not.toContain('FA-V');
  });

  it('the package the app makes carries a hash the inbox accepts, and the inbox lists its changes', () => {
    const pkg = pkgOf(villa);
    const html = renderToStaticMarkup(<InboxView project={villa} pending={[{ pkg, hash: pkg.sha256 }]} me="A. Engineer" onOpen={noop} onDecided={noop} onPlace={noop} onStatus={noop} />);
    expect(html).toContain('ELV loads');
    expect(html).toContain(`Accept selected (${pkg.items.length})`);
    const accepted = decide(villa, pkg, pkg.sha256, { accept: 'all', by: 'A. Engineer', at: '2026-10-27T08:01:00.000Z' }).project;
    expect(exchangeOf(accepted).packages).toHaveLength(1);
    const after = renderToStaticMarkup(<InboxView project={accepted} pending={[]} me="" onOpen={noop} onDecided={noop} onPlace={noop} onStatus={noop} />);
    expect(after).toContain('Nothing waiting');
    expect(after).toContain('X-001');
  });

  it('placing from the app adds the circuits and records the engineer on the kW proposal', () => {
    const pkg = pkgOf(villa);
    const accepted = decide(villa, pkg, pkg.sha256, { accept: 'all', by: 'A. Engineer', at: '2026-10-27T08:01:00.000Z' }).project;
    const placed = placeElvLoads(accepted, {}, 'A. Engineer', 'A. Engineer');
    expect(placed.added).toHaveLength(pkg.items.length);
    expect(placed.proposal).toBeUndefined();
    // A later estimate with a bigger office: the circuit is not changed, a proposal is made in the engineer's name.
    const bigger = { ...placed.project, building: { ...placed.project.building!, rooms: placed.project.building!.rooms.map((r) => (r.id === 'R2' ? { ...r, areaM2: 240 } : r)) } };
    const next = pkgOf(bigger);
    const again = decide(bigger, next, next.sha256, { accept: 'all', by: 'A. Engineer', at: '2026-10-27T09:00:00.000Z' }).project;
    const r = placeElvLoads(again, {}, 'A. Engineer', 'A. Engineer');
    expect(r.proposal).toBeDefined();
    const rec = r.project.modifications!.find((m) => m.id === r.proposal)!;
    expect(rec.author).toBe('A. Engineer');
    expect(r.project.feeders.filter((f) => f.elvLoad).map((f) => f.loadKw)).toEqual(again.feeders.filter((f) => f.elvLoad).map((f) => f.loadKw));
  });
});
