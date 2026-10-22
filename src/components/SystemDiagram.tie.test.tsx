// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SystemDiagram from './SystemDiagram';
import { sampleProject } from '../data/sampleProject';
import { evaluateProject } from '../calc/electrical';
import { applyDrop, removeTie, TIE_OPERATION, tieRatings, updateTie } from '../model/sldEdit';
import type { Project } from '../types';

const noop = () => {};
const tied = (): Project => {
  let p = applyDrop(sampleProject, { kind: 'transformer' }, { type: 'canvas' }).project;
  p = applyDrop(p, { kind: 'tie' }, { type: 'bus', boardId: 'MDB-1' }).project;
  return p;
};
const coupler = (p: Project) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <SystemDiagram project={p} calcProject={p} results={evaluateProject(p)} selectedFeederId={null} selectedBoardId={null} onSelectFeeder={noop} onSelectBoard={noop} onDrawing={noop} />
  );
  const g = host.querySelector('.sysdiag > svg g.tie')!;
  return { title: g.querySelector('title')!.textContent!, label: [...g.querySelectorAll('text')].map((t) => t.textContent).join(' | '), lines: g.querySelectorAll('line.ln').length, closedClass: g.classList.contains('closed'), g };
};

describe('bus coupler: normally open or closed', () => {
  it('updateTie sets the operation and rating; open drops the flag', () => {
    const p = tied();
    const closed = updateTie(p, 'BC-1', { closed: true, ratingA: 2000 });
    expect(closed.ties).toEqual([{ id: 'BC-1', a: 'MDB-1', b: 'MDB-2', ratingA: 2000, closed: true }]);
    expect(updateTie(closed, 'BC-1', { closed: false }).ties).toEqual([{ id: 'BC-1', a: 'MDB-1', b: 'MDB-2', ratingA: 2000 }]);
    expect(updateTie(closed, 'BC-1', { ratingA: 2500 }).ties![0]).toMatchObject({ ratingA: 2500, closed: true }); // operation kept
    expect(updateTie(p, 'BC-9', { closed: true })).toEqual({ ...p, ties: p.ties }); // unknown id: nothing changes
    expect(removeTie(closed, 'BC-1').ties).toEqual([]);
  });

  it('dialog choices: three operations; standard ratings from 400 A with the present one', () => {
    expect(Object.values(TIE_OPERATION)).toHaveLength(3);
    expect(tieRatings(1600)).toEqual(['400 A', '500 A', '630 A', '800 A', '1000 A', '1250 A', '1600 A', '2000 A', '2500 A', '3200 A', '4000 A']);
    expect(tieRatings(1500)).toContain('1500 A');
  });

  it('SLD: N/O with an open breaker, or N/C with a closed one; the click edits instead of removing', () => {
    const open = coupler(tied());
    expect(open.label).toBe('BC-1 · 1600 A | N/O');
    expect(open.title).toBe('BC-1: bus coupler 1600 A, normally open — click to change or remove');
    const closed = coupler(updateTie(tied(), 'BC-1', { closed: true }));
    expect(closed.label).toBe('BC-1 · 1600 A | N/C');
    expect(closed.title).toMatch(/normally closed — transformers in parallel/);
    // Closed breaker: the straight line across the symbol, as the outage scenario draws it.
    const bar = closed.g.querySelector('line.ln')!;
    expect(bar.getAttribute('y1')).toBe(bar.getAttribute('y2'));
    expect(open.g.querySelector('line.ln')!.getAttribute('y1')).not.toBe(open.g.querySelector('line.ln')!.getAttribute('y2'));
    expect(closed.closedClass).toBe(false); // the green "running" look stays for the outage scenario
  });
});
