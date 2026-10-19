import { z } from 'zod';
import { TOOLS, callTool, toolByName, type Tool, type ToolContext } from './tools';
import { projectsFolder } from './project';
import { startMcp } from './mcp';
import { startApi } from './api';

/** The `lvds` command: every tool from the command line, plus `lvds mcp` (MCP server) and
 * `lvds serve` (local API). Read only. Exit code: 0 done, 1 checks failed (run_checks), 2 error. */

const ALIASES: Record<string, string> = {
  projects: 'list_projects', summary: 'project_summary', panels: 'list_panels', panel: 'get_panel',
  check: 'run_checks', results: 'circuit_results', current: 'calc_current', vd: 'calc_voltage_drop',
  cable: 'calc_cable_size', transformer: 'calc_transformer', fault: 'calc_fault_level', motor: 'calc_motor', pfc: 'calc_pf_correction'
};

interface Parsed { command?: string; positional: string[]; flags: Record<string, unknown>; json: boolean; folder?: string; port?: number }

export function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { positional: [], flags: {}, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { out.json = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      const value = eq > 0 ? a.slice(eq + 1) : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      const v: unknown = value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value;
      if (key === 'folder') out.folder = String(value);
      else if (key === 'port') out.port = Number(value);
      else out.flags[key] = v;
      continue;
    }
    if (!out.command) out.command = a;
    else out.positional.push(a);
  }
  return out;
}

// ---- Plain text output -------------------------------------------------------

const cell = (v: unknown): string => (v === undefined || v === null ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '  (none)';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => rows.some((r) => r[c] !== undefined));
  const w = cols.map((c) => Math.min(48, Math.max(c.length, ...rows.map((r) => cell(r[c]).length))));
  // The last column (usually the text) is never cut short.
  const last = cols.length - 1;
  const line = (vals: string[]) => '  ' + vals.map((v, i) => (i === last ? v : v.length > w[i] ? v.slice(0, w[i] - 1) + '…' : v.padEnd(w[i]))).join('  ').trimEnd();
  return [line(cols), line(w.map((n) => '-'.repeat(n))), ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join('\n');
}

export function formatText(v: unknown): string {
  if (Array.isArray(v)) return v.every((x) => typeof x === 'object' && x !== null) ? table(v as Record<string, unknown>[]) : v.map(cell).join('\n');
  if (typeof v !== 'object' || v === null) return cell(v);
  const lines: string[] = [];
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue;
    if (Array.isArray(x) && x.some((y) => typeof y === 'object' && y !== null)) lines.push(`${k}:`, table(x as Record<string, unknown>[]));
    else lines.push(`${k}: ${cell(x)}`);
  }
  return lines.join('\n');
}

// ---- Help --------------------------------------------------------------------

function usage(t: Tool): string {
  const shape = z.object(t.input).shape as Record<string, z.ZodType>;
  const opts = Object.entries(shape).filter(([k]) => !(t.usesProject && k === 'project'));
  const flags = opts.map(([k, s]) => {
    const optional = s.safeParse(undefined).success;
    return optional ? `[--${k} …]` : `--${k} …`;
  });
  const alias = Object.entries(ALIASES).find(([, n]) => n === t.name)?.[0];
  return `  lvds ${alias ?? t.name}${t.usesProject ? ' <project>' : ''}${t.name === 'get_panel' ? ' <panel>' : ''} ${flags.filter((f) => !(t.name === 'get_panel' && f.includes('--panel'))).join(' ')}`.trimEnd() + `\n      ${t.description}`;
}

function help(version: string): string {
  return [
    `LV Design Studio command line ${version} — read and check projects (read only)`,
    '',
    'Usage:',
    ...TOOLS.map(usage),
    '',
    '  lvds mcp                 Run the MCP server (stdio) for Claude Desktop, Claude Code or a local model',
    '  lvds serve [--port 8765] Run the local API on http://127.0.0.1 (read only)',
    '  lvds help <command>      Inputs of one command',
    '',
    'Options: --json (JSON output), --folder <path> (projects folder; default: the app\'s, or LVDS_PROJECTS)',
    'A <project> is a file name in the projects folder, or a path to a project .json file.'
  ].join('\n');
}

function commandHelp(t: Tool): string {
  const shape = z.object(t.input).shape as Record<string, z.ZodType>;
  const rows = Object.entries(shape).map(([k, s]) => ({ input: `--${k}`, about: s.description ?? '', default: s.safeParse(undefined).success ? cell((s.safeParse(undefined) as { data?: unknown }).data) : '(required)' }));
  return `${usage(t)}\n\n${table(rows)}`;
}

// ---- Run ---------------------------------------------------------------------

export async function main(argv: string[], version: string, io: { out: (s: string) => void; err: (s: string) => void } = { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n') }): Promise<number> {
  const a = parseArgs(argv);
  const ctx: ToolContext = { folder: a.folder ?? projectsFolder(), anywhere: true };
  const cmd = a.command;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    const t = a.positional[0] ? toolByName(ALIASES[a.positional[0]] ?? a.positional[0]) : undefined;
    io.out(t ? commandHelp(t) : help(version));
    return 0;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') { io.out(version); return 0; }
  if (cmd === 'mcp') { await startMcp({ ...ctx, anywhere: false }, version); return -1; }
  if (cmd === 'serve') {
    const port = a.port ?? 8765;
    await startApi({ ...ctx, anywhere: false }, version, port);
    io.err(`LV Design Studio local API (read only): http://127.0.0.1:${port}/api/tools  — projects folder ${ctx.folder}. Ctrl+C to stop.`);
    return -1;
  }
  const t = toolByName(ALIASES[cmd] ?? cmd);
  if (!t) { io.err(`Unknown command "${cmd}". Run "lvds help".`); return 2; }

  const args: Record<string, unknown> = { ...a.flags };
  const pos = [...a.positional];
  if (t.usesProject && args.project === undefined && pos.length) args.project = pos.shift();
  if (t.name === 'get_panel' && args.panel === undefined && pos.length) args.panel = pos.shift();
  if (pos.length) { io.err(`Unexpected "${pos.join(' ')}". Run "lvds help ${cmd}".`); return 2; }
  try {
    const result = callTool(t, args, ctx);
    io.out(a.json ? JSON.stringify(result, null, 2) : formatText(result));
    return t.name === 'run_checks' && (result as { fail: number }).fail > 0 ? 1 : 0;
  } catch (e) {
    io.err(`Error: ${(e as Error).message}`);
    return 2;
  }
}
