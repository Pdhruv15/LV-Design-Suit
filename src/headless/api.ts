import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import { callTool, offeredTools, toolByName, type ToolContext } from './tools';
import { appDataDir, redactPaths } from './project';

/** Local HTTP JSON API for other programs on this computer (Excel, Python, scripts):
 *   GET  /api/tools          the tools and their inputs (JSON Schema)
 *   GET  /api/tools/<name>?project=…&panel=…   run a tool (numbers in the query are read as numbers)
 *   POST /api/tools/<name>   run a tool with a JSON body
 * Every request needs `Authorization: Bearer <token>`. The token is random (32 bytes), made when the server starts
 * and written only to a file readable by this user (apiTokenFile()); it is never printed, logged or put in a URL.
 * Listens on 127.0.0.1 only, accepts only a localhost Host header (no DNS rebinding), refuses requests that a
 * browser page makes (an Origin or a cross-site Sec-Fetch-Site header) and sends no CORS headers. Tools that change
 * a project only when started with --write (POST with JSON only). */

const send = (res: http.ServerResponse, code: number, body: unknown, extra: Record<string, string> = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(JSON.stringify(body));
};

const fromQuery = (q: URLSearchParams): Record<string, unknown> =>
  Object.fromEntries([...q.entries()].map(([k, v]) => [k, v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v]));

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => { text += c; if (text.length > 1e6) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => {
      if (!text.trim()) return resolve({});
      try {
        const v = JSON.parse(text) as unknown;
        if (typeof v !== 'object' || v === null || Array.isArray(v)) reject(new Error('The body must be a JSON object'));
        else resolve(v as Record<string, unknown>);
      } catch { reject(new Error('The body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

/** A new API token: 32 random bytes, URL-safe base64 (43 characters). */
export const newApiToken = () => crypto.randomBytes(32).toString('base64url');

/** Where `lvds serve` writes its token for local clients: in the app's data folder, readable by this user only. */
export const apiTokenFile = () => path.join(appDataDir(), 'api-token');

/** Compare the presented token with the server's in constant time (hashing first gives equal lengths). */
export function tokenMatches(presented: string | undefined, token: string): boolean {
  if (!presented) return false;
  const a = crypto.createHash('sha256').update(presented).digest(), b = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

const bearer = (h: string | undefined) => /^Bearer\s+(\S+)\s*$/i.exec(h ?? '')?.[1];

export function createApi(ctx: ToolContext, version: string, token: string): http.Server {
  if (token.length < 32) throw new Error('The API token must be at least 32 characters');
  return http.createServer(async (req, res) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(res, 403, { error: 'Only local requests are accepted' });
    // Browsers add Origin (and Sec-Fetch-Site) to requests a web page makes; local programs do not. No page may call this.
    const site = req.headers['sec-fetch-site'];
    if (req.headers.origin !== undefined || (site !== undefined && site !== 'none')) return send(res, 403, { error: 'Requests from web pages are not accepted' });
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST' }, { Allow: 'GET, POST' });
    if (!tokenMatches(bearer(req.headers.authorization), token)) return send(res, 401, { error: 'Missing or wrong API token. Send Authorization: Bearer <token> (see "lvds help serve").' }, { 'WWW-Authenticate': 'Bearer' });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const tools = offeredTools(ctx);
    if (url.pathname === '/api' || url.pathname === '/api/') return send(res, 200, { name: 'LV Design Studio local API', version, readOnly: !ctx.write, tools: '/api/tools' });
    if (url.pathname === '/api/tools' && req.method === 'GET') {
      return send(res, 200, tools.map((t) => ({ name: t.name, title: t.title, description: t.description, changesProject: !!t.writes, input: z.toJSONSchema(z.object(t.input), { io: 'input' }) })));
    }
    const m = /^\/api\/tools\/([\w-]+)$/.exec(url.pathname);
    const t = m ? toolByName(m[1], tools) : undefined;
    if (!t) return send(res, 404, { error: 'Not found. See /api/tools' });
    // A change only from a POST with a JSON body: a link or an <img> can never make one.
    if (t.writes && (req.method !== 'POST' || !/^application\/json\b/i.test(req.headers['content-type'] ?? ''))) return send(res, 405, { error: 'Tools that change a project need POST with Content-Type: application/json' });
    try {
      const args = req.method === 'POST' ? await readBody(req) : fromQuery(url.searchParams);
      send(res, 200, await callTool(t, args, ctx));
    } catch (e) {
      send(res, 400, { error: redactPaths((e as Error).message, ctx.folder) });
    }
  });
}

/** Writes the token for local clients: a new file only this user can read (0600), replacing an older one. */
export function writeApiToken(token: string, file = apiTokenFile()): string {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, token + '\n', { mode: 0o600, flag: 'wx' });
  return file;
}

/** Starts the API with a token: LVDS_API_TOKEN when set (for a fixed client setup), else a new random one written to apiTokenFile(). */
export function startApi(ctx: ToolContext, version: string, port: number): Promise<{ server: http.Server; tokenFile?: string }> {
  const fixed = process.env.LVDS_API_TOKEN?.trim();
  if (fixed !== undefined && fixed.length < 32) return Promise.reject(new Error('LVDS_API_TOKEN must be at least 32 characters (e.g. from: openssl rand -base64 32)'));
  const token = fixed || newApiToken();
  const server = createApi(ctx, version, token);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const tokenFile = fixed ? undefined : writeApiToken(token);
      // The token file is only valid while this server runs.
      if (tokenFile) server.once('close', () => { try { if (fs.readFileSync(tokenFile, 'utf-8').trim() === token) fs.rmSync(tokenFile, { force: true }); } catch { /* gone */ } });
      resolve({ server, tokenFile });
    });
  });
}
