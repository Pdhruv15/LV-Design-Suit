// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, onScreenThemeChange, resolveTheme, screenTheme, withPrintTheme } from './theme';
import { loadPrefs } from '../model/profile';

const html = () => document.documentElement;
afterEach(() => { applyTheme('dark'); localStorage.clear(); });

describe('screen theme', () => {
  it('defaults to dark, written as no attribute', () => {
    applyTheme(undefined);
    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(resolveTheme(undefined)).toBe('dark');
  });

  it('switches to light and back', () => {
    applyTheme('light');
    expect(html().getAttribute('data-theme')).toBe('light');
    applyTheme('dark');
    expect(html().hasAttribute('data-theme')).toBe(false);
  });

  it('reads exports with the dark palette and restores the screen theme', () => {
    applyTheme('light');
    const seen = withPrintTheme(() => html().getAttribute('data-theme'));
    expect(seen).toBeNull();
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it('restores the screen theme even when the export throws', () => {
    applyTheme('light');
    expect(() => withPrintTheme(() => { throw new Error('boom'); })).toThrow('boom');
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it('reports a theme change to canvas drawing, but not the export switch and back', async () => {
    const seen: string[] = [];
    const off = onScreenThemeChange((t) => seen.push(t));
    const flush = () => new Promise((r) => setTimeout(r, 0));
    applyTheme('light');
    await flush();
    expect(seen).toEqual(['light']);
    expect(screenTheme()).toBe('light');
    withPrintTheme(() => null);
    await flush();
    expect(seen).toEqual(['light']);
    applyTheme('dark');
    await flush();
    expect(seen).toEqual(['light', 'dark']);
    off();
    applyTheme('light');
    await flush();
    expect(seen).toEqual(['light', 'dark']);
  });

  it('ignores an unknown stored theme', () => {
    localStorage.setItem('lvds.preferences', JSON.stringify({ app: { autosaveMin: 5, theme: 'neon' } }));
    const p = loadPrefs();
    expect(p.app.theme).toBeUndefined();
    expect(p.app.autosaveMin).toBe(5);
  });

  it('keeps a valid stored theme', () => {
    localStorage.setItem('lvds.preferences', JSON.stringify({ app: { theme: 'light' } }));
    expect(loadPrefs().app.theme).toBe('light');
  });
});
