// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isOlderBuild } from '../util/webApp';

const state = { offline: 'ready', canInstall: false, installed: true, install: async () => {}, newVersion: null as string | null };
vi.mock('../util/webApp', async (orig) => ({ ...(await orig<typeof import('../util/webApp')>()), useWebApp: () => state }));
const { default: WebBanner } = await import('./WebBanner');

describe('web version: a newer build', () => {
  afterEach(() => { state.newVersion = null; sessionStorage.clear(); });

  it('is one whose entry script differs from the open page\'s', () => {
    expect(isOlderBuild('https://x.github.io/LV/assets/index-AAA.js', 'assets/index-BBB.js')).toBe(true);
    expect(isOlderBuild('https://x.github.io/LV/assets/index-AAA.js', 'assets/index-AAA.js')).toBe(false);
    expect(isOlderBuild(undefined, 'assets/index-BBB.js')).toBe(false); // dev server: no built script
    expect(isOlderBuild('https://x.github.io/LV/assets/index-AAA.js', undefined)).toBe(false); // an older service worker that doesn't say
  });

  it('offers Reload with the new version, even when the banner was hidden', () => {
    expect(renderToStaticMarkup(<WebBanner />)).toContain('Ready for offline use');
    sessionStorage.setItem('lvds.webBanner', 'hidden');
    expect(renderToStaticMarkup(<WebBanner />)).toBe('');
    state.newVersion = '2.013';
    const html = renderToStaticMarkup(<WebBanner />);
    expect(html).toContain('New version 2.013 — reload');
    expect(html).not.toContain('Ready for offline use');
  });
});
