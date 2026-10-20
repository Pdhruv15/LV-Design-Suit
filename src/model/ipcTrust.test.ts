import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type Win = { webContents: unknown; isDestroyed: () => boolean };
type Event = { sender: unknown; senderFrame: { url: string } | null };
interface Trust {
  DEFAULT_DEV_URL: string;
  devUrlFrom: (env: Record<string, string | undefined>) => string;
  appUrlTest: (o: { isDev: boolean; devOrigin?: string; entryFile?: string }) => (url: string) => boolean;
  appOriginTest: (o: { isDev: boolean; devOrigin?: string }) => (origin: unknown) => boolean;
  senderProblem: (event: Event | undefined, win: Win | undefined, isAppUrl: (u: string) => boolean) => string | undefined;
  trustedHandler: (ipc: { handle: (c: string, fn: (e: Event, ...a: unknown[]) => unknown) => void }, getWin: () => Win | undefined, isAppUrl: (u: string) => boolean) => (c: string, fn: (e: Event, ...a: unknown[]) => unknown) => void;
  permissionRequestOk: (o: { wc: unknown; win: Win | undefined; permission: string; requestingUrl: string; allowed: Set<string>; isAppUrl: (u: string) => boolean }) => boolean;
  permissionCheckOk: (o: { wc: unknown; win: Win | undefined; permission: string; requestingOrigin: string; allowed: Set<string>; isAppOrigin: (o: unknown) => boolean }) => boolean;
  externalUrl: (url: string) => string | undefined;
}
const require = createRequire(import.meta.url);
const trust = require('../../electron/trust.cjs') as Trust;

const ENTRY = '/Applications/LV Design Studio.app/Contents/Resources/app.asar/dist/index.html';
const ENTRY_URL = pathToFileURL(ENTRY).href;
const DEV = 'http://127.0.0.1:5173';

/** A fake app window and the frames that could call from it. */
function fakeWindow(url = ENTRY_URL) {
  const mainFrame = { url };
  const webContents = { mainFrame };
  const win: Win = { webContents, isDestroyed: () => false };
  return { win, webContents, mainFrame };
}

describe('development origin', () => {
  it('defaults to an exact loopback origin', () => {
    expect(trust.devUrlFrom({})).toBe(DEV);
    expect(trust.devUrlFrom({ LVDS_DEV_URL: 'http://[::1]:5180/' })).toBe('http://[::1]:5180');
  });
  it('refuses anything that is not http on a loopback address with a port', () => {
    for (const bad of ['http://localhost:5173', 'http://evil.example:5173', 'https://127.0.0.1:5173', 'http://127.0.0.1', 'http://user:pw@127.0.0.1:5173', 'file:///x', 'not a url']) {
      expect(() => trust.devUrlFrom({ LVDS_DEV_URL: bad }), bad).toThrow();
    }
  });
});

describe('the app page', () => {
  const packaged = trust.appUrlTest({ isDev: false, entryFile: ENTRY });
  const dev = trust.appUrlTest({ isDev: true, devOrigin: DEV });
  it('packaged: only the bundled index.html', () => {
    expect(packaged(ENTRY_URL)).toBe(true);
    expect(packaged(`${ENTRY_URL}#/design?x=1`)).toBe(true);
    for (const bad of ['file:///tmp/evil.html', `file://remote-host${new URL(ENTRY_URL).pathname}`, 'data:text/html,<b>x</b>', DEV, 'https://example.com/index.html', 'about:blank', 'garbage']) {
      expect(packaged(bad), bad).toBe(false);
    }
  });
  it('development: only the exact dev-server origin', () => {
    expect(dev(`${DEV}/`)).toBe(true);
    expect(dev(`${DEV}/src/main.tsx`)).toBe(true);
    for (const bad of ['http://127.0.0.1:5174/', 'http://localhost:5173/', 'http://127.0.0.1.evil.example:5173/', 'data:text/html,x', ENTRY_URL]) {
      expect(dev(bad), bad).toBe(false);
    }
  });
});

describe('IPC callers', () => {
  const isApp = trust.appUrlTest({ isDev: false, entryFile: ENTRY });

  it('accepts the main frame of the app window', () => {
    const { win, webContents, mainFrame } = fakeWindow();
    expect(trust.senderProblem({ sender: webContents, senderFrame: mainFrame }, win, isApp)).toBeUndefined();
  });

  it('refuses a child frame, another window, another page and a closed window', () => {
    const { win, webContents, mainFrame } = fakeWindow();
    const other = fakeWindow();
    expect(trust.senderProblem({ sender: webContents, senderFrame: { url: ENTRY_URL } }, win, isApp)).toBe('not the top frame');
    expect(trust.senderProblem({ sender: other.webContents, senderFrame: other.mainFrame }, win, isApp)).toBe('not the app window');
    for (const url of ['data:text/html,x', 'file:///tmp/evil.html', 'http://127.0.0.1:9999/']) {
      const page = fakeWindow(url);
      expect(trust.senderProblem({ sender: page.webContents, senderFrame: page.mainFrame }, page.win, isApp), url).toBe('not the app page');
    }
    expect(trust.senderProblem({ sender: webContents, senderFrame: null }, win, isApp)).toBe('no sending frame');
    expect(trust.senderProblem({ sender: webContents, senderFrame: mainFrame }, { ...win, isDestroyed: () => true }, isApp)).toBe('no app window');
    expect(trust.senderProblem({ sender: webContents, senderFrame: mainFrame }, undefined, isApp)).toBe('no app window');
  });

  it('refuses before the handler runs, so nothing happens', () => {
    const handlers = new Map<string, (e: Event, ...a: unknown[]) => unknown>();
    const { win, webContents, mainFrame } = fakeWindow();
    const handle = trust.trustedHandler({ handle: (c, fn) => handlers.set(c, fn) }, () => win, isApp);
    let calls = 0;
    handle('projects:emptyTrash', (_e, ...a) => { calls++; return a; });
    const call = handlers.get('projects:emptyTrash')!;
    const child = { sender: webContents, senderFrame: { url: ENTRY_URL } };
    const stranger = fakeWindow('data:text/html,x');
    expect(() => call(child, 1)).toThrow(/Refused: projects:emptyTrash \(not the top frame\)/);
    expect(() => call({ sender: stranger.webContents, senderFrame: stranger.mainFrame })).toThrow(/Refused/);
    expect(calls).toBe(0);
    expect(call({ sender: webContents, senderFrame: mainFrame }, 'a', 2)).toEqual(['a', 2]);
    expect(calls).toBe(1);
  });
});

describe('permissions', () => {
  const allowed = new Set(['clipboard-sanitized-write']);
  const isAppUrl = trust.appUrlTest({ isDev: false, entryFile: ENTRY });
  const isAppOrigin = trust.appOriginTest({ isDev: false });
  it('grants clipboard writing to the app page only', () => {
    const { win, webContents } = fakeWindow();
    const other = fakeWindow();
    expect(trust.permissionRequestOk({ wc: webContents, win, permission: 'clipboard-sanitized-write', requestingUrl: ENTRY_URL, allowed, isAppUrl })).toBe(true);
    expect(trust.permissionRequestOk({ wc: webContents, win, permission: 'media', requestingUrl: ENTRY_URL, allowed, isAppUrl })).toBe(false);
    expect(trust.permissionRequestOk({ wc: other.webContents, win, permission: 'clipboard-sanitized-write', requestingUrl: ENTRY_URL, allowed, isAppUrl })).toBe(false);
    expect(trust.permissionRequestOk({ wc: webContents, win, permission: 'clipboard-sanitized-write', requestingUrl: 'data:text/html,x', allowed, isAppUrl })).toBe(false);
    expect(trust.permissionCheckOk({ wc: webContents, win, permission: 'clipboard-sanitized-write', requestingOrigin: 'file:///', allowed, isAppOrigin })).toBe(true);
    expect(trust.permissionCheckOk({ wc: other.webContents, win, permission: 'clipboard-sanitized-write', requestingOrigin: 'file:///', allowed, isAppOrigin })).toBe(false);
    expect(trust.permissionCheckOk({ wc: null, win, permission: 'clipboard-sanitized-write', requestingOrigin: 'file:///', allowed, isAppOrigin })).toBe(false);
    expect(trust.permissionCheckOk({ wc: webContents, win, permission: 'clipboard-sanitized-write', requestingOrigin: 'https://evil.example', allowed, isAppOrigin })).toBe(false);
  });
});

describe('links to the system browser', () => {
  it('opens https links only', () => {
    expect(trust.externalUrl('https://example.com/download')).toBe('https://example.com/download');
    for (const bad of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'https://user:pw@example.com', 'not a url']) expect(trust.externalUrl(bad), bad).toBeUndefined();
  });
});

describe('main process wiring', () => {
  const main = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8');
  it('registers every IPC handler through the trusted wrapper', () => {
    expect(main).not.toMatch(/ipcMain\.(handle|on|once|handleOnce)\(/);
    const registered = new Set([...main.matchAll(/^handle\('([^']+)'/gm)].map((m) => m[1]));
    const invoked = new Set([...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]));
    expect(invoked.size).toBeGreaterThan(20);
    for (const channel of invoked) expect(registered.has(channel), channel).toBe(true);
  });
  it('binds dialogs to the calling window and keeps web security on', () => {
    expect(main).not.toMatch(/show(Open|Save)Dialog\(win,/);
    expect(main.match(/webSecurity: true/g)?.length).toBeGreaterThanOrEqual(2);
    expect(main).not.toMatch(/localhost:5173/);
  });
});
