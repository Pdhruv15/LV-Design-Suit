const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const START_TIMEOUT_MS = 30000;
/** Extended-data application LV Design Studio tags its drawing objects with ("feeder:<id>", "board:<id>"). */
const TAG_APP = 'LVDS';
const PAGE = 1000;
const MAX_ENTITIES = 200000;
const REQUEST_TIMEOUT_MS = 30000;

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function requestJson({ port, token, method = 'GET', route, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({
      host: '127.0.0.1', port, method, path: `/api/v1${route}`,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
      }
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch { return reject(new Error(`OpenCADStudio returned invalid JSON (${response.statusCode}).`)); }
        if ((response.statusCode || 500) >= 400 || data.ok === false) {
          return reject(new Error(data.error || data.message || data.code || `OpenCADStudio request failed (${response.statusCode}).`));
        }
        resolve(data);
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('OpenCADStudio automation request timed out.')));
    request.once('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

class OpenCadRestSession {
  constructor(options = {}) {
    this.spawn = options.spawn || spawn;
    this.portFactory = options.portFactory || availablePort;
    this.request = options.request || requestJson;
    this.process = null;
    this.port = 0;
    this.token = '';
    this.version = '';
    this.stderr = '';
  }

  get connected() {
    return !!this.process && this.process.exitCode === null && !!this.port && !!this.token;
  }

  status() {
    return { connected: this.connected, version: this.version || undefined };
  }

  async start(executable, firstDrawing) {
    if (this.connected) return this.status();
    this.port = await this.portFactory();
    this.token = crypto.randomBytes(32).toString('hex');
    this.stderr = '';
    const child = this.spawn(executable, [firstDrawing, '--http', String(this.port)], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, OCS_API_TOKEN: this.token }
    });
    this.process = child;
    let spawnError;
    child.once('error', (error) => { spawnError = error; });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-16000); });
    child.once('exit', () => { if (this.process === child) this.process = null; });

    const deadline = Date.now() + START_TIMEOUT_MS;
    let lastError;
    while (Date.now() < deadline) {
      if (spawnError) {
        this.process = null;
        throw new Error(`Could not start OpenCADStudio: ${spawnError.message}`);
      }
      if (child.exitCode !== null) throw new Error(this.stderr.trim() || `OpenCADStudio exited with code ${child.exitCode}.`);
      try {
        const ready = await this.request({ port: this.port, token: this.token, route: '/ready', timeoutMs: 1500 });
        this.version = String(ready.version || ready.result?.version || '');
        return this.status();
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    child.kill();
    this.process = null;
    throw new Error(`OpenCADStudio automation did not become ready. ${lastError instanceof Error ? lastError.message : ''}`.trim());
  }

  /** Equipment tagged in the active drawing: [{ tag, handles }], one entry per board or feeder, in tag order. */
  async linkedEquipment() {
    if (!this.connected) throw new Error('OpenCADStudio is not connected.');
    const ask = (route, method = 'GET', body) => this.request({ port: this.port, token: this.token, method, route, body });
    const handles = [];
    for (let offset = 0; offset < MAX_ENTITIES;) {
      const page = await ask(`/entities?fields=handle&limit=${PAGE}&offset=${offset}`);
      for (const e of page.entities || []) if (typeof e.handle === 'string') handles.push(e.handle);
      if (typeof page.next_offset !== 'number' || page.next_offset <= offset) break;
      offset = page.next_offset;
    }
    const byTag = new Map();
    for (let i = 0; i < handles.length; i += PAGE) {
      const read = await ask('/xdata_get', 'POST', { handles: handles.slice(i, i + PAGE), app: TAG_APP });
      for (const item of read.items || []) {
        const tag = item && item.xdata && Array.isArray(item.xdata[TAG_APP]) ? item.xdata[TAG_APP][0] : undefined;
        if (typeof tag !== 'string' || !/^(feeder|board):/.test(tag)) continue;
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag).push(item.handle);
      }
    }
    return [...byTag].sort(([a], [b]) => a.localeCompare(b)).map(([tag, list]) => ({ tag, handles: list }));
  }

  async open(executable, drawings) {
    if (!Array.isArray(drawings) || drawings.length === 0) throw new Error('No drawing was supplied to OpenCADStudio.');
    let first = 0;
    if (!this.connected) {
      await this.start(executable, drawings[0]);
      first = 1;
    }
    for (let index = first; index < drawings.length; index += 1) {
      await this.request({ port: this.port, token: this.token, method: 'POST', route: '/documents', body: { path: drawings[index] } });
    }
    const state = await this.request({ port: this.port, token: this.token, route: '/state' });
    return { ...this.status(), files: drawings, state };
  }
}

module.exports = { availablePort, requestJson, OpenCadRestSession, TAG_APP };
