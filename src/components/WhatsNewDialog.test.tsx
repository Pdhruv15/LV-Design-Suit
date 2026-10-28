// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsNewDialog from './WhatsNewDialog';
import { pendingReleases, markSeen, RELEASES } from '../model/whatsNew';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear(); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;

describe("What's new window", () => {
  it('lists the release with buttons that open each feature', () => {
    const onAction = vi.fn(), onClose = vi.fn();
    act(() => root.render(<WhatsNewDialog releases={RELEASES.slice(0, 1)} onAction={onAction} onClose={onClose} />));
    expect(document.body.textContent).toContain(`What's new in v${RELEASES[0].version}`);
    const first = RELEASES[0].items.find((it) => it.action)!;
    act(() => button(first.actionLabel ?? 'Show me').click());
    expect(onAction).toHaveBeenCalledWith(first.action);
    act(() => button('Close').click());
    expect(onClose).toHaveBeenCalled();
  });

  it('shows once after an update, never on a new install', () => {
    expect(pendingReleases('1.84')).toEqual([]); // new install: nothing saved yet
    expect(localStorage.getItem('lvds.whatsNewSeen')).toBe('1.84');
    localStorage.clear();
    localStorage.setItem('lvds.preferences', '{}'); // used before, updated from a version without What's new
    expect(pendingReleases('1.84').map((r) => r.version)).toEqual(['1.84']);
    markSeen('1.84');
    expect(pendingReleases('1.84')).toEqual([]);
  });
});
