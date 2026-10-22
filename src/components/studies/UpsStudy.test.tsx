// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import UpsStudy from './UpsStudy';
import { sampleProject } from '../../data/sampleProject';
import { UPS_DEFAULTS } from '../../calc/ups';
import type { Project } from '../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });

const field = (label: string) => [...document.querySelectorAll('label.nf')].find((l) => l.querySelector('span')?.textContent === label)!.querySelector('input')!;
const enter = (el: HTMLInputElement, value: string) => act(() => { el.value = value; el.focus(); el.blur(); });

describe('UPS study: input filter and generator leading kvar', () => {
  const project: Project = { ...sampleProject, upsSystems: [{ ...UPS_DEFAULTS, id: 'u1', name: 'UPS 1', loads: [{ id: 'l', name: 'Load', qty: 1, w: 5000 }] }] };

  it('shows the typical figures as placeholders and sets, then clears, the entered values', () => {
    let last = project;
    const render = (p: Project) => act(() => root.render(<UpsStudy project={p} onChange={(x) => { last = x; render(x); }} onStatus={() => {}} />));
    render(project);
    expect(field('Input filter').placeholder).toBe('10 % of UPS kVA');
    expect(field('Generator absorbs').placeholder).toBe('10');

    enter(field('Input filter'), '7.5');
    enter(field('Generator absorbs'), '15');
    expect(last.upsSystems![0]).toMatchObject({ inputFilterKvar: 7.5, genLeadingPct: 15 });

    enter(field('Input filter'), '');
    enter(field('Generator absorbs'), '');
    expect(last.upsSystems![0].inputFilterKvar).toBeUndefined();
    expect(last.upsSystems![0].genLeadingPct).toBeUndefined();
  });
});
