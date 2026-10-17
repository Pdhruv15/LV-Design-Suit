// Who may call the main process. The preload bridge exposes privileged work (project files, trash, the
// database, exports, PDF rendering, the Python engine), so every IPC call is checked before it does
// anything: it must come from the app's own main window, from its top frame (not a frame inside the
// page), showing the app's own page — the packaged index.html, or in development the exact dev-server
// origin. Kept free of Electron imports so it can be tested on its own.

const { pathToFileURL } = require('node:url');

/** Development server: an exact loopback origin, never "anything on localhost". */
const DEFAULT_DEV_URL = 'http://127.0.0.1:5173';

/** The dev server URL from LVDS_DEV_URL, accepted only as http on a loopback address with a port. */
function devUrlFrom(env = process.env) {
  const raw = env.LVDS_DEV_URL || DEFAULT_DEV_URL;
  let u;
  try { u = new URL(raw); } catch { throw new Error(`LVDS_DEV_URL is not a URL: ${raw}`); }
  if (u.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(u.hostname) || !u.port || u.username || u.password) {
    throw new Error(`LVDS_DEV_URL must be http on 127.0.0.1 or [::1] with a port, not ${raw}`);
  }
  return u.origin;
}

/** The test for "this URL is the app's own page".
 * Packaged: exactly the bundled index.html (file:), any query or hash ignored.
 * Development: exactly the dev-server origin. */
function appUrlTest({ isDev, devOrigin, entryFile }) {
  const entry = entryFile ? pathToFileURL(entryFile).href : undefined;
  return (url) => {
    let u;
    try { u = new URL(url); } catch { return false; }
    if (isDev) return u.origin === devOrigin;
    return u.protocol === 'file:' && !u.host && entry !== undefined && u.pathname === new URL(entry).pathname;
  };
}

/** The matching test for a permission's requesting origin (an origin, not a full URL). */
function appOriginTest({ isDev, devOrigin }) {
  return (origin) => {
    if (typeof origin !== 'string') return false;
    if (isDev) return origin === devOrigin;
    return origin === 'file://' || origin === 'file:///';
  };
}

/** The same frame: the same object, or the same process and routing IDs (Electron may hand out a new object). */
const sameFrame = (a, b) => !!a && !!b && (a === b || (Number.isInteger(a.processId) && Number.isInteger(a.routingId) && a.processId === b.processId && a.routingId === b.routingId));

/** Why an IPC call is refused, or undefined when it comes from the app's own page in its main window.
 * event: Electron's IpcMainInvokeEvent; win: the app's main BrowserWindow; isAppUrl: from appUrlTest. */
function senderProblem(event, win, isAppUrl) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return 'no app window';
  if (!event || event.sender !== win.webContents) return 'not the app window';
  const frame = event.senderFrame;
  if (!frame) return 'no sending frame';
  if (!sameFrame(frame, event.sender.mainFrame)) return 'not the top frame';
  if (!isAppUrl(frame.url)) return 'not the app page';
  return undefined;
}

/** Registers an IPC handler that runs only for trusted callers; anything else is refused before the
 * handler (and so before any dialog, file or process work). */
function trustedHandler(ipcMain, getWin, isAppUrl, onRefused = () => {}) {
  return (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    const why = senderProblem(event, getWin(), isAppUrl);
    if (why) {
      onRefused(channel, why, event);
      throw new Error(`Refused: ${channel} (${why})`);
    }
    return handler(event, ...args);
  });
}

/** Permission requests and checks: only from the app's main window showing the app's own page, and only
 * the permissions in `allowed`. */
function permissionRequestOk({ wc, win, permission, requestingUrl, allowed, isAppUrl }) {
  return !!win && !win.isDestroyed() && wc === win.webContents && isAppUrl(requestingUrl) && allowed.has(permission);
}
function permissionCheckOk({ wc, win, permission, requestingOrigin, allowed, isAppOrigin }) {
  return !!win && !win.isDestroyed() && !!wc && wc === win.webContents && isAppOrigin(requestingOrigin) && allowed.has(permission);
}

/** A link the app may hand to the system browser: https only, with a host and no credentials. */
function externalUrl(url) {
  let u;
  try { u = new URL(url); } catch { return undefined; }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return undefined;
  return u.href;
}

module.exports = { DEFAULT_DEV_URL, devUrlFrom, appUrlTest, appOriginTest, senderProblem, trustedHandler, permissionRequestOk, permissionCheckOk, externalUrl };
