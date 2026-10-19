import http from 'node:http';
import { z } from 'zod';
import { TOOLS, callTool, toolByName, type ToolContext } from './tools';

/** Local HTTP JSON API for other programs on this computer (Excel, Python, scripts):
 *   GET  /api/tools          the tools and their inputs (JSON Schema)
 *   GET  /api/tools/<name>?project=…&panel=…   run a tool (numbers in the query are read as numbers)
 *   POST /api/tools/<name>   run a tool with a JSON body
 * Listens on 127.0.0.1 only, accepts only a localhost Host header (no DNS rebinding) and sends no
 * CORS headers, so web pages cannot call it. Stage 1: read only. */

const send = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
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

export function createApi(ctx: ToolContext, version: string): http.Server {
  return http.createServer(async (req, res) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(res, 403, { error: 'Only local requests are accepted' });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api' || url.pathname === '/api/') return send(res, 200, { name: 'LV Design Studio local API', version, readOnly: true, tools: '/api/tools' });
    if (url.pathname === '/api/tools' && req.method === 'GET') {
      return send(res, 200, TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, input: z.toJSONSchema(z.object(t.input), { io: 'input' }) })));
    }
    const m = /^\/api\/tools\/([\w-]+)$/.exec(url.pathname);
    const t = m ? toolByName(m[1]) : undefined;
    if (!t) return send(res, 404, { error: 'Not found. See /api/tools' });
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST' });
    try {
      const args = req.method === 'POST' ? await readBody(req) : fromQuery(url.searchParams);
      send(res, 200, callTool(t, args, ctx));
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
    }
  });
}

export function startApi(ctx: ToolContext, version: string, port: number): Promise<http.Server> {
  const server = createApi(ctx, version);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
