const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const START_TIMEOUT_MS = 30000;
/** Extended-data application LV Design Studio tags its drawing objects with ("feeder:<id>", "board:<id>"). */
const TAG_APP = 'LVDS';
const PAGE = 1000;
const MAX_ENTITIES = 200000;
const EQUIPMENT = /^(feeder|board):/;

/** The LVDS tag of an entity read with detail=full, from its extended-data records. */
function tagOf(entity) {
  const records = entity && entity.properties && entity.properties.common && entity.properties.common.extended_data && entity.properties.common.extended_data.records;
  const record = Array.isArray(records) ? records.find((r) => r && r.application_name === TAG_APP) : undefined;
  const value = record && Array.isArray(record.values) && record.values[0] ? record.values[0].String : undefined;
  return typeof value === 'string' && /^(feeder|board|sheet|route|place|tray):/.test(value) ? value : undefined;
}

const xy = (p) => (p && typeof p.x === 'number' && typeof p.y === 'number' ? [p.x, p.y] : undefined);
/** Length of one straight or bulged (arc) polyline segment; bulge = tan(θ/4). */
function segmentLength(a, b, bulge) {
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!bulge || !chord) return chord;
  const theta = 4 * Math.atan(Math.abs(bulge));
  return (chord / (2 * Math.sin(theta / 2))) * theta;
}
/** Points along a bulged polyline segment from a to b (straight: just b), every ~10°. */
function segmentPoints(a, b, bulge) {
  if (!bulge) return [b];
  const theta = 4 * Math.atan(bulge); // signed sweep
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!chord) return [b];
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)) * (Math.abs(theta) > Math.PI ? -1 : 1) * Math.sign(theta);
  const centre = [mid[0] - (h * (b[1] - a[1])) / chord, mid[1] + (h * (b[0] - a[0])) / chord];
  const start = Math.atan2(a[1] - centre[1], a[0] - centre[0]);
  const steps = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 18)));
  return Array.from({ length: steps }, (_, i) => {
    const t = start + (theta * (i + 1)) / steps;
    return [centre[0] + r * Math.cos(t), centre[1] + r * Math.sin(t)];
  });
}
/** A curve as a path of points (drawing units): lines, arcs, polylines with arc segments; else undefined. */
function curvePoints(entity) {
  const p = (entity && entity.properties) || {};
  if (entity.type === 'Line') {
    const a = xy(p.start), b = xy(p.end);
    return a && b ? [a, b] : undefined;
  }
  if (entity.type === 'Arc' && typeof p.radius === 'number' && xy(p.center)) {
    const c = xy(p.center);
    const sweep = ((((p.end_angle - p.start_angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) || 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 18)));
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = p.start_angle + (sweep * i) / steps;
      return [c[0] + p.radius * Math.cos(t), c[1] + p.radius * Math.sin(t)];
    });
  }
  if (Array.isArray(p.vertices) && /polyline/i.test(entity.type)) {
    const v = p.vertices.map((x) => ({ at: xy(x && x.location), bulge: Number(x && x.bulge) || 0 })).filter((x) => x.at);
    if (v.length < 2) return undefined;
    const closed = p.is_closed === true || !!(p.flags && typeof p.flags.bits === 'number' && p.flags.bits & 1);
    const out = [v[0].at];
    for (let i = 0; i + 1 < v.length; i += 1) out.push(...segmentPoints(v[i].at, v[i + 1].at, v[i].bulge));
    if (closed) out.push(...segmentPoints(v[v.length - 1].at, v[0].at, v[v.length - 1].bulge));
    return out;
  }
  return undefined;
}

const BOARD_ATTRIBUTES = ['TAG', 'BOARD', 'PANEL', 'DB', 'DB_REF', 'BOARD_ID', 'PANEL_ID'];
/** A point for an entity read with detail=full: a block's insertion point, else its bounds centre. */
function pointOf(entity) {
  if (Array.isArray(entity.position) && entity.position.length >= 2) return [entity.position[0], entity.position[1]];
  const b = entity.bounds;
  if (b && Array.isArray(b.min) && Array.isArray(b.max)) return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
  return undefined;
}
/** A closed outline (room boundary) from a closed polyline or a hatch's outer boundary: its vertices, and the bulges
 * of arc segments when it has any; else undefined. */
function closedOutline(entity) {
  const p = entity.properties || {};
  if (entity.type === 'Hatch' && Array.isArray(p.paths)) {
    const path = p.paths.find((x) => x && x.flags && x.flags.bits & 1) || p.paths[0];
    const points = [];
    const bulges = [];
    for (const edge of (path && path.edges) || []) {
      if (edge && edge.Polyline && Array.isArray(edge.Polyline.vertices)) {
        for (const v of edge.Polyline.vertices) { const at = xy(v); if (at) { points.push(at); bulges.push(Number(v.bulge) || 0); } }
      } else if (edge && edge.Line && xy(edge.Line.start)) {
        points.push(xy(edge.Line.start)); bulges.push(0);
      }
    }
    return points.length >= 3 ? { points, ...(bulges.some(Boolean) ? { bulges } : {}) } : undefined;
  }
  if (!/polyline/i.test(entity.type) || !Array.isArray(p.vertices)) return undefined;
  const closed = p.is_closed === true || !!(p.flags && typeof p.flags.bits === 'number' && p.flags.bits & 1);
  const v = p.vertices.map((x) => ({ at: xy(x && x.location), bulge: Number(x && x.bulge) || 0 })).filter((x) => x.at);
  if (!closed || v.length < 3) return undefined;
  const bulges = v.map((x) => x.bulge);
  return { points: v.map((x) => x.at), ...(bulges.some(Boolean) ? { bulges } : {}) };
}
const ROOM_NAME_ATTRIBUTES = ['NAME', 'ROOM', 'ROOM_NAME', 'ROOMNAME', 'SPACE', 'SPACE_NAME', 'ROOM-NAME'];
const ROOM_NUMBER_ATTRIBUTES = ['NO', 'NUMBER', 'ROOM_NO', 'ROOM_NUMBER', 'ROOMNO', 'NUM', 'ROOM-NO'];
const attributeOf = (attributes, names) => {
  const key = Object.keys(attributes || {}).find((k) => names.includes(k.trim().toUpperCase()));
  const value = key && typeof attributes[key] === 'string' ? attributes[key].trim() : '';
  return value || undefined;
};

/** Plan length of a curve read with detail=full, in drawing units: lines, arcs, and polylines (2D, light-weight)
 * with arc segments. Anything else (circles, text, blocks) has no route length: 0. */
function curveLength(entity) {
  const p = (entity && entity.properties) || {};
  if (entity.type === 'Line') {
    const a = xy(p.start), b = xy(p.end);
    return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
  }
  if (entity.type === 'Arc' && typeof p.radius === 'number') {
    const sweep = ((((p.end_angle - p.start_angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) || 2 * Math.PI;
    return p.radius * sweep;
  }
  if (Array.isArray(p.vertices) && /polyline/i.test(entity.type)) {
    const v = p.vertices.map((x) => ({ at: xy(x && x.location), bulge: Number(x && x.bulge) || 0 })).filter((x) => x.at);
    const closed = p.is_closed === true || !!(p.flags && typeof p.flags.bits === 'number' && p.flags.bits & 1);
    let length = 0;
    for (let i = 0; i + 1 < v.length; i += 1) length += segmentLength(v[i].at, v[i + 1].at, v[i].bulge);
    if (closed && v.length > 2) length += segmentLength(v[v.length - 1].at, v[0].at, v[v.length - 1].bulge);
    return length;
  }
  return 0;
}

// Database identity differs between two loads of the same drawing; geometry and properties do not.
const IDENTITY = new Set(['handle', 'owner_handle', 'reactors', 'xdictionary_handle', 'full_visual_style_handle']);
function canonical(value) {
  if (typeof value === 'number') return Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).filter((k) => !IDENTITY.has(k)).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}
/** A comparable print of one entity: its type and serialized properties without database identity. */
function fingerprint(entity) {
  return JSON.stringify([entity.type, canonical(entity.properties || {})]);
}
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
    /** Per OpenCADStudio document id: tag → hash of what LV Design Studio last sent there. */
    this.sent = new Map();
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

  ask(route, method = 'GET', body) {
    return this.request({ port: this.port, token: this.token, method, route, body });
  }

  async activeDocument() {
    const state = await this.ask('/state');
    if (state.document_id === undefined || state.document_id === null) throw new Error('No drawing is open in OpenCADStudio.');
    return state.document_id;
  }

  /** Objects of the active drawing tagged by LV Design Studio: Map tag → { handles, hash }. The hash
   * fingerprints the tag's geometry and properties, so two loads of the same sheet compare equal. */
  async readTagged() {
    if (!this.connected) throw new Error('OpenCADStudio is not connected. Open the drawing in OpenCADStudio first.');
    const byTag = new Map();
    let seen = 0;
    for (let offset = 0; seen < MAX_ENTITIES;) {
      const page = await this.ask(`/entities?detail=full&limit=${PAGE}&offset=${offset}`);
      const list = page.entities || [];
      seen += list.length;
      for (const e of list) {
        const tag = tagOf(e);
        if (!tag || typeof e.handle !== 'string') continue;
        if (!byTag.has(tag)) byTag.set(tag, { handles: [], prints: [] });
        const entry = byTag.get(tag);
        entry.handles.push(e.handle);
        entry.prints.push(fingerprint(e));
      }
      if (typeof page.next_offset !== 'number' || page.next_offset <= offset || !list.length) break;
      offset = page.next_offset;
    }
    const out = new Map();
    for (const [tag, { handles, prints }] of byTag) {
      out.set(tag, { handles, hash: crypto.createHash('sha1').update(prints.sort().join('\n')).digest('hex') });
    }
    return out;
  }

  /** Boards and feeders tagged in the active drawing: [{ tag, handles }], in tag order. */
  async linkedEquipment() {
    const tagged = await this.readTagged();
    return [...tagged].filter(([tag]) => EQUIPMENT.test(tag)).sort(([a], [b]) => a.localeCompare(b)).map(([tag, { handles }]) => ({ tag, handles }));
  }

  /** Remembers what LV Design Studio last sent to the active drawing, so a later update compares the new sheet
   * with that (and keeps any tagged object the engineer edited for equipment that did not change).
   * Returns how many boards and feeders the drawing links. */
  async remember() {
    const document = await this.activeDocument();
    const tagged = await this.readTagged();
    this.sent.set(document, new Map([...tagged].map(([tag, { hash }]) => [tag, hash])));
    return [...tagged.keys()].filter((tag) => EQUIPMENT.test(tag)).length;
  }

  /** Brings the drawing open in OpenCADStudio up to date with a newly generated sheet: only the tagged objects of
   * boards, feeders and sheet furniture that changed are replaced; untagged objects (the engineer's own CAD
   * work) are never touched. Returns the tags changed, added and removed, and how many were unchanged. */
  async update(sheetPath) {
    const target = await this.activeDocument();
    const current = await this.readTagged();
    if (![...current.keys()].some((tag) => EQUIPMENT.test(tag))) {
      throw new Error('The drawing open in OpenCADStudio has no LV Design Studio boards or feeders. Open the SLD from LV Design Studio first.');
    }
    await this.ask('/documents', 'POST', { path: sheetPath });
    const source = await this.activeDocument();
    if (source === target) throw new Error('OpenCADStudio did not open the updated sheet as a separate drawing.');
    let fresh;
    let created = [];
    const plan = { changed: [], added: [], removed: [], unchanged: 0 };
    try {
      fresh = await this.readTagged();
      const sent = this.sent.get(target) || new Map([...current].map(([tag, { hash }]) => [tag, hash]));
      for (const [tag, { hash }] of fresh) {
        if (!current.has(tag)) plan.added.push(tag);
        else if (sent.get(tag) !== hash) plan.changed.push(tag);
        else plan.unchanged += 1;
      }
      for (const tag of current.keys()) if (!fresh.has(tag)) plan.removed.push(tag);
      const copy = [...plan.changed, ...plan.added].flatMap((tag) => fresh.get(tag).handles);
      for (let i = 0; i < copy.length; i += PAGE) {
        const result = await this.ask('/entities/copy-to', 'POST', { handles: copy.slice(i, i + PAGE), document_id: target });
        created = created.concat((result.result && result.result.created) || []);
      }
    } finally {
      await this.ask(`/documents/${source}?discard=true`, 'DELETE').catch(() => undefined);
    }
    if (await this.activeDocument() !== target) {
      throw new Error(`OpenCADStudio did not return to the drawing after the update; ${created.length} new objects were added, the old ones are still in place.`);
    }
    const erase = [...plan.changed, ...plan.removed].flatMap((tag) => current.get(tag).handles);
    for (let i = 0; i < erase.length; i += PAGE) await this.ask('/entities', 'DELETE', { handles: erase.slice(i, i + PAGE) });
    this.sent.set(target, new Map([...fresh].map(([tag, { hash }]) => [tag, hash])));
    return plan;
  }

  /** Cable routes linked to feeders in the active drawing (curves tagged "route:<feeder id>"), measured in drawing
   * units, with the drawing's INSUNITS code. */
  async readRoutes() {
    const tagged = new Map();
    if (!this.connected) throw new Error('OpenCADStudio is not connected. Open the floor plan in OpenCADStudio first.');
    let seen = 0;
    for (let offset = 0; seen < MAX_ENTITIES;) {
      const page = await this.ask(`/entities?detail=full&limit=${PAGE}&offset=${offset}`);
      const list = page.entities || [];
      seen += list.length;
      for (const e of list) {
        const tag = tagOf(e);
        if (!tag || !tag.startsWith('route:')) continue;
        const id = tag.slice('route:'.length);
        const at = tagged.get(id) || { feederId: id, length: 0, pieces: 0 };
        at.length += curveLength(e);
        at.pieces += 1;
        tagged.set(id, at);
      }
      if (typeof page.next_offset !== 'number' || page.next_offset <= offset || !list.length) break;
      offset = page.next_offset;
    }
    const units = await this.ask('/sysvars?names=insunits').then((r) => (r.result && r.result.values ? r.result.values.insunits : undefined), () => undefined);
    return { units: typeof units === 'number' ? units : undefined, routes: [...tagged.values()] };
  }

  /** What a floor plan says about where boards are: board symbols (tagged "place:<board id>", or blocks whose TAG /
   * BOARD / PANEL attribute names a board), closed outlines (rooms) and texts (room names), in drawing units. */
  async readPlan() {
    if (!this.connected) throw new Error('OpenCADStudio is not connected. Open the floor plan in OpenCADStudio first.');
    const plan = { places: [], symbols: [], outlines: [], texts: [], tags: [] };
    const layers = new Map();
    const count = (layer, kind) => {
      const at = layers.get(layer) || { name: layer, outlines: 0, curves: 0, texts: 0, blocks: 0, hatches: 0 };
      at[kind] += 1;
      layers.set(layer, at);
    };
    let seen = 0;
    for (let offset = 0; seen < MAX_ENTITIES;) {
      const page = await this.ask(`/entities?detail=full&limit=${PAGE}&offset=${offset}`);
      const list = page.entities || [];
      seen += list.length;
      for (const e of list) {
        const tag = tagOf(e);
        const at = pointOf(e);
        if (tag && tag.startsWith('place:') && at) plan.places.push({ boardId: tag.slice('place:'.length), x: at[0], y: at[1] });
        const layer = String(e.layer || '');
        if (typeof e.block === 'string') {
          count(layer, 'blocks');
          if (e.attributes && at) {
            const board = attributeOf(e.attributes, BOARD_ATTRIBUTES);
            if (board) plan.symbols.push({ name: board, x: at[0], y: at[1] });
            const name = attributeOf(e.attributes, ROOM_NAME_ATTRIBUTES), number = attributeOf(e.attributes, ROOM_NUMBER_ATTRIBUTES);
            if (name || number) plan.tags.push({ layer, x: at[0], y: at[1], ...(name ? { name } : {}), ...(number ? { number } : {}) });
          }
        }
        const outline = closedOutline(e);
        if (outline) { plan.outlines.push({ layer, ...outline }); count(layer, e.type === 'Hatch' ? 'hatches' : 'outlines'); }
        else if (/^(Line|Arc|Polyline.*)$/.test(e.type)) count(layer, 'curves');
        const p = e.properties || {};
        const text = typeof p.value === 'string' ? p.value : typeof p.text === 'string' ? p.text : typeof p.contents === 'string' ? p.contents : undefined;
        if (/^(Text|MText|Multiline Text)$/i.test(e.type) && text && text.trim() && at) { plan.texts.push({ layer, x: at[0], y: at[1], text: text.trim() }); count(layer, 'texts'); }
      }
      if (typeof page.next_offset !== 'number' || page.next_offset <= offset || !list.length) break;
      offset = page.next_offset;
    }
    const units = await this.ask('/sysvars?names=insunits').then((r) => (r.result && r.result.values ? r.result.values.insunits : undefined), () => undefined);
    return { units: typeof units === 'number' ? units : undefined, ...plan, layers: [...layers.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  /** Tray runs (curves tagged "tray:<route name>") and cable routes ("route:<feeder id>") of the active drawing as
   * paths of points, in drawing units, for working out which trays each cable follows. */
  async readTrays() {
    if (!this.connected) throw new Error('OpenCADStudio is not connected. Open the floor plan in OpenCADStudio first.');
    const trays = [], routes = [];
    let seen = 0;
    for (let offset = 0; seen < MAX_ENTITIES;) {
      const page = await this.ask(`/entities?detail=full&limit=${PAGE}&offset=${offset}`);
      const list = page.entities || [];
      seen += list.length;
      for (const e of list) {
        const tag = tagOf(e);
        if (!tag || !(tag.startsWith('tray:') || tag.startsWith('route:'))) continue;
        const points = curvePoints(e);
        if (!points) continue;
        if (tag.startsWith('tray:')) trays.push({ name: tag.slice('tray:'.length), points, length: curveLength(e) });
        else routes.push({ feederId: tag.slice('route:'.length), points });
      }
      if (typeof page.next_offset !== 'number' || page.next_offset <= offset || !list.length) break;
      offset = page.next_offset;
    }
    const units = await this.ask('/sysvars?names=insunits').then((r) => (r.result && r.result.values ? r.result.values.insunits : undefined), () => undefined);
    return { units: typeof units === 'number' ? units : undefined, trays, routes };
  }

  /** Links the curves selected in OpenCADStudio to a tray route by name ("A"); '' unlinks them. */
  async traySelection(name) {
    if (!this.connected) throw new Error('OpenCADStudio is not connected. Open the floor plan in OpenCADStudio first.');
    const route = String(name || '').trim().toUpperCase();
    if (route && !/^[\x21-\x7e]{1,40}$/.test(route)) throw new Error('A tray route name is letters, digits and signs without spaces, e.g. A or T-2.');
    const selection = await this.ask('/get_selection', 'POST', {});
    const picked = (selection.result && selection.result.entities) || [];
    if (!picked.length) throw new Error('Nothing is selected in OpenCADStudio. Select the tray run there first.');
    const curves = picked.filter((e) => e && typeof e.handle === 'string' && /^(Line|Arc|Polyline.*)$/.test(e.type));
    for (const e of curves) {
      if (route) await this.ask(`/entities/${e.handle}/xdata/${TAG_APP}`, 'PUT', [{ code: 1000, value: `tray:${route}` }]);
      else await this.ask(`/entities/${e.handle}/xdata/${TAG_APP}`, 'DELETE').catch(() => undefined);
    }
    return { linked: curves.length, skipped: picked.length - curves.length };
  }

  /** Marks the objects selected in OpenCADStudio as a board's symbol on the plan (tag "place:<board id>");
   * an empty id unlinks them. */
  async placeSelection(boardId) {
    if (!this.connected) throw new Error('OpenCADStudio is not connected. Open the floor plan in OpenCADStudio first.');
    if (boardId && !/^[\x21-\x7e]{1,193}$/.test(boardId)) throw new Error('That board cannot be linked (its ID has unusual characters).');
    const selection = await this.ask('/get_selection', 'POST', {});
    const picked = ((selection.result && selection.result.entities) || []).filter((e) => e && typeof e.handle === 'string');
    if (!picked.length) throw new Error('Nothing is selected in OpenCADStudio. Select the board symbol there first.');
    for (const e of picked) {
      if (boardId) await this.ask(`/entities/${e.handle}/xdata/${TAG_APP}`, 'PUT', [{ code: 1000, value: `place:${boardId}` }]);
      else await this.ask(`/entities/${e.handle}/xdata/${TAG_APP}`, 'DELETE').catch(() => undefined);
    }
    return { linked: picked.length };
  }

  /** Links the curves selected in OpenCADStudio to a feeder's cable route (tag "route:<id>"); other selected
   * objects are skipped. An empty id unlinks the selection instead. */
  async linkSelection(feederId) {
    if (!this.connected) throw new Error('OpenCADStudio is not connected. Open the floor plan in OpenCADStudio first.');
    if (feederId && !/^[\x21-\x7e]{1,193}$/.test(feederId)) throw new Error('That feeder cannot be linked (its ID has unusual characters).');
    const selection = await this.ask('/get_selection', 'POST', {});
    const picked = (selection.result && selection.result.entities) || [];
    if (!picked.length) throw new Error('Nothing is selected in OpenCADStudio. Select the cable route there first.');
    const curves = picked.filter((e) => e && typeof e.handle === 'string' && /^(Line|Arc|Polyline.*)$/.test(e.type));
    for (const e of curves) {
      if (feederId) await this.ask(`/entities/${e.handle}/xdata/${TAG_APP}`, 'PUT', [{ code: 1000, value: `route:${feederId}` }]);
      else await this.ask(`/entities/${e.handle}/xdata/${TAG_APP}`, 'DELETE').catch(() => undefined);
    }
    return { linked: curves.length, skipped: picked.length - curves.length };
  }

  /** Blocks placed in the active drawing (e.g. light fittings on a floor plan): [{ block, attributes }]. */
  async readBlocks() {
    if (!this.connected) throw new Error('OpenCADStudio is not connected. Open the floor plan in OpenCADStudio first.');
    const out = [];
    for (let offset = 0; out.length < MAX_ENTITIES;) {
      const page = await this.ask(`/entities?type=Insert&fields=handle,block,attributes&limit=${PAGE}&offset=${offset}`);
      const list = page.entities || [];
      for (const e of list) {
        if (!e || typeof e.block !== 'string') continue;
        const attributes = {};
        for (const [tag, value] of Object.entries(e.attributes && typeof e.attributes === 'object' ? e.attributes : {})) {
          if (typeof value === 'string') attributes[tag] = value;
        }
        out.push({ block: e.block, attributes });
      }
      if (typeof page.next_offset !== 'number' || page.next_offset <= offset || !list.length) break;
      offset = page.next_offset;
    }
    return out;
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

module.exports = { availablePort, requestJson, OpenCadRestSession, TAG_APP, tagOf, fingerprint, curveLength, curvePoints };
