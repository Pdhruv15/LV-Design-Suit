// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateElv } from '../../elv/estimate';
import type { Project } from '../../types';
import ElvSchedules from './ElvSchedules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const project: Project = {
  name: 'Villa', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }] }], rooms: [{ id: 'R1', buildingId: 'V', levelId: 'GF', name: 'Majlis', type: 'living', areaM2: 40 }, { id: 'R2', buildingId: 'V', levelId: 'GF', name: 'Office', type: 'office', areaM2: 24 }] }
};
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
const tab = (name: string) => [...host.querySelectorAll('[role=tab]')].find((b) => b.textContent === name) as HTMLButtonElement;

describe('ELV schedules on the ELV page', () => {
  it('shows each schedule and keeps a remark typed on a row', () => {
    const onChange = vi.fn();
    act(() => root.render(<ElvSchedules project={project} estimate={estimateElv(project)} onChange={onChange} onStatus={() => {}} />));
    expect(host.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Devices');
    expect(host.textContent).toContain('Majlis');
    const input = host.querySelector('input[aria-label="Remarks: Office"]') as HTMLInputElement;
    act(() => { input.focus(); input.value = 'Reader at the door'; input.blur(); });
    expect((onChange.mock.calls[0][0] as Project).elvRemarks).toEqual({ 'devices:R2': 'Reader at the door' });
    act(() => tab('Fire alarm loops').click());
    expect(host.textContent).toMatch(/No fire alarm devices placed on the plans yet/);
    act(() => tab('BOQ').click());
    expect(host.textContent).toContain('Fire alarm control panel');
  });

  it('adds the ticked ELV systems to the project BOQ, none ticked at first', () => {
    const onChange = vi.fn();
    act(() => root.render(<ElvSchedules project={project} estimate={estimateElv(project)} onChange={onChange} onStatus={() => {}} />));
    act(() => ([...host.querySelectorAll('button')].find((b) => b.textContent === 'Add to project BOQ…') as HTMLButtonElement).click());
    const boxes = [...document.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    const add = () => [...document.querySelectorAll('button')].find((b) => /^Add \d system/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    act(() => boxes[0].click());
    act(() => add().click());
    expect((onChange.mock.calls[0][0] as Project).elvBoq!.systems).toEqual(['fire-alarm']);
  });
});
