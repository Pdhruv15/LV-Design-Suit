// A web version left open while new builds go live. Serves a build from this computer, opens it in a hidden window and
// lets its service worker take charge; then replaces the build on the server, as a deployment does (the old files are
// gone), and has the page look for updates as the app does. Only the test page loads, not the app, and nothing leaves
// this computer.
//   electron tests/electron/webUpdate.cjs <out.json> <build folder> <next build folder> ...
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('webUpdate.cjs')) + 1);
const [output, ...builds] = args;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let site = builds[0];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(site, name);
    if (!file.startsWith(site) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Runs in the page; a step that never ends fails the check instead of hanging it. */
  const inPage = (wc, code) => Promise.race([wc.executeJavaScript(code), sleep(30000).then(() => { throw new Error(`no answer from: ${code}`); })]);
  /** Waits until the build that took over has finished tidying up (its activate step, which deletes the oldest builds,
   * runs after the page has been taken over): a fixed wait was not always long enough on CI. */
  const settled = `navigator.serviceWorker.ready.then((reg) => { const w = reg.active; return !w || w.state === 'activated' || new Promise((r) => w.addEventListener('statechange', () => { if (w.state === 'activated') r(true); })); })`;
  const result = {};
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition: `web-update-${Date.now()}` } });
    const wc = win.webContents;
    wc.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, done) => done({ cancel: !d.url.startsWith(base) }));
    await win.loadURL(base);
    await inPage(wc, 'window.ready()');
    // Each new build goes live and takes over the open page, which has not opened the later page yet.
    for (const next of builds.slice(1)) {
      site = next;
      await inPage(wc, 'window.takeOver()');
      await sleep(1000); // the page is in its hands before it has finished tidying up; a person clicks long after
      await inPage(wc, settled);
    }
    result.kept = await inPage(wc, 'caches.keys().then((k) => k.length)');
    await inPage(wc, 'document.querySelector("#open").click()');
    await sleep(1000);
    result.after = await inPage(wc, `({
      alive: !!document.querySelector('#open'),
      later: document.querySelector('#later')?.textContent ?? null,
      notLoaded: document.querySelector('.page-not-loaded')?.textContent ?? null,
      errors: window.errors
    })`);
    // With no connection, a page opened now gets the newest build, not an older one kept for pages left open.
    server.closeAllConnections();
    server.close();
    await win.loadURL(base);
    await sleep(300);
    result.offline = await inPage(wc, `document.querySelector('script[type="module"][src]')?.src.split('/').pop() ?? null`);
    result.newest = fs.readdirSync(path.join(builds[builds.length - 1], 'assets')).find((f) => f.startsWith('index-') && f.endsWith('.js'));
    win.destroy();
    fs.writeFileSync(output, JSON.stringify(result));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (server.listening) server.close();
    app.quit();
  }
});
