import { z } from 'zod';
import { allTools, callTool, toolByName, type Tool, type ToolContext } from './tools';
import { projectsFolder } from './project';
import { startMcp } from './mcp';
import { startApi } from './api';

/** The `lvds` command: every tool from the command line, plus `lvds mcp` (MCP server) and
 * `lvds serve` (local API). Tools that change a project preview unless given --apply (structure) or
 * --propose (value changes); the servers offer them only with --write.
 * Exit code: 0 done, 1 checks failed (run_checks), 2 error. */

const ALIASES: Record<string, string> = {
  projects: 'list_projects', summary: 'project_summary', panels: 'list_panels', panel: 'get_panel',
  check: 'run_checks', results: 'circuit_results', current: 'calc_current', vd: 'calc_voltage_drop',
  cable: 'calc_cable_size', transformer: 'calc_transformer', fault: 'calc_fault_level', motor: 'calc_motor', pfc: 'calc_pf_correction',
  propose: 'propose_changes', size: 'size_circuits', 'add-panel': 'add_panel', 'add-circuit': 'add_circuit', move: 'move_panel',
  rename: 'rename_panels', copy: 'copy_panel', changes: 'list_changes', undo: 'undo_change',
  'delete-panel': 'delete_panel', 'delete-circuit': 'delete_circuit',
  'exchange-check': 'exchange_check', 'exchange-review': 'exchange_review', 'exchange-apply': 'exchange_apply', 'rooms-package': 'export_rooms_package', elv: 'elv_estimate', 'elv-package': 'export_elv_loads_package',
  exports: 'list_exports', report: 'export_report', 'forms-xlsx': 'export_forms_xlsx', 'boq-xlsx': 'export_boq_xlsx', dxf: 'export_dxf'
};

/** Flags that never take a value. */
const SWITCHES = new Set(['json', 'apply', 'propose', 'export', 'write']);

interface Parsed { command?: string; positional: string[]; flags: Record<string, unknown>; json: boolean; folder?: string; port?: number; write: boolean; commit: boolean }

/** A flag value: a number, true / false, JSON for a list or object (e.g. --changes '[{"target":"feeder",…}]'), else text. */
function flagValue(value: string): unknown {
  const t = value.trim();
  if (t !== '' && Number.isFinite(Number(t))) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  if (t.startsWith('[') || t.startsWith('{')) { try { return JSON.parse(t); } catch { /* text */ } }
  return value;
}

export function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { positional: [], flags: {}, json: false, write: false, commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (SWITCHES.has(key) && eq < 0) {
        if (key === 'json') out.json = true;
        else if (key === 'write') out.write = true;
        else out.commit = true; // --apply / --propose / --export
        continue;
      }
      const value = eq > 0 ? a.slice(eq + 1) : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      if (key === 'folder') out.folder = String(value);
      else if (key === 'port') out.port = Number(value);
      else out.flags[key] = flagValue(value);
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
  const posPanel = ['get_panel', 'move_panel', 'copy_panel'].includes(t.name), posTo = ['move_panel', 'copy_panel'].includes(t.name);
  const shown = flags.filter((f) => !(posPanel && f.includes('--panel ')) && !(posTo && f.includes('--to ')) && !f.includes('--mode '));
  const commitMode = t.writes ? (['propose', 'export', 'apply'] as const).find((m) => 'mode' in t.input && (t.input.mode as z.ZodType).safeParse(m).success) : undefined;
  const commit = commitMode ? ` [--${commitMode}]` : '';
  return `  lvds ${alias ?? t.name}${t.usesProject ? ' <project>' : ''}${posPanel ? ' <panel>' : ''}${posTo ? ' <to>' : ''} ${shown.join(' ')}${commit}`.replace(/(\S) {2,}/g, '$1 ').trimEnd() + `\n      ${t.description}`;
}

function help(version: string): string {
  return [
    `LV Design Studio command line ${version}`,
    '',
    'Read and check:',
    ...allTools().filter((t) => !t.writes && t.name !== 'list_changes' && t.name !== 'list_exports').map(usage),
    '',
    'Change a project (a preview unless --apply / --propose; every change is kept and can be undone):',
    ...allTools().filter((t) => (t.writes && !t.name.startsWith('export_')) || t.name === 'list_changes').map(usage),
    '',
    'Export (a preview unless --export; needs --approvedBy "<engineer>"; never over an existing file):',
    ...allTools().filter((t) => t.name.startsWith('export_') || t.name === 'list_exports').map(usage),
    '',
    '  lvds mcp [--write]                 Run the MCP server (stdio) for Claude Desktop, Claude Code or a local model',
    '  lvds serve [--port 8765] [--write] Run the local API on http://127.0.0.1 (needs its token: lvds help serve)',
    '  (--write also offers the tools that change a project; without it both are read only)',
    '  lvds help <command>      Inputs of one command',
    '',
    'Options: --json (JSON output), --folder <path> (projects folder; default: the app\'s, or LVDS_PROJECTS)',
    'Lists (--changes, --renames) are given as JSON, e.g. --renames \'[{"from":"DB-1","to":"DB-L1-01"}]\'',
    'A <project> is a file name in the projects folder, or a path to a project .json file.'
  ].join('\n');
}

/** `lvds help serve`: how a local program authenticates to the API. */
export const SERVE_HELP = [
  'lvds serve [--port 8765] [--write]',
  '',
  'Runs the local API on http://127.0.0.1:<port>/api/tools for programs on this computer.',
  'Every request needs the header  Authorization: Bearer <token>',
  'The token is new each time the server starts. It is written to a file only you can read,',
  'named when the server starts (in the app data folder, file "api-token"), and removed when it stops.',
  'It is never printed, and never goes in a URL. Set LVDS_API_TOKEN (32+ characters) to use your own fixed token instead.',
  'Requests from web pages (with an Origin header) are refused. --write also offers the tools that change a project (POST with JSON).',
  '',
  'Example (macOS / Linux):',
  '  curl -H "Authorization: Bearer $(cat <token file>)" http://127.0.0.1:8765/api/tools/run_checks?project=My%20project'
].join('\n');

function commandHelp(t: Tool): string {
  const shape = z.object(t.input).shape as Record<string, z.ZodType>;
  const rows = Object.entries(shape).map(([k, s]) => ({ input: `--${k}`, about: s.description ?? '', default: s.safeParse(undefined).success ? cell((s.safeParse(undefined) as { data?: unknown }).data) : '(required)' }));
  return `${usage(t)}\n\n${table(rows)}`;
}

// ---- Run ---------------------------------------------------------------------

export async function main(argv: string[], version: string, io: { out: (s: string) => void; err: (s: string) => void } = { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n') }): Promise<number> {
  const a = parseArgs(argv);
  const ctx: ToolContext = { folder: a.folder ?? projectsFolder(), anywhere: true, write: true };
  const cmd = a.command;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    if (a.positional[0] === 'serve') { io.out(SERVE_HELP); return 0; }
    const t = a.positional[0] ? toolByName(ALIASES[a.positional[0]] ?? a.positional[0]) : undefined;
    io.out(t ? commandHelp(t) : help(version));
    return 0;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') { io.out(version); return 0; }
  if (cmd === 'mcp') { await startMcp({ ...ctx, anywhere: false, write: a.write }, version); return -1; }
  if (cmd === 'serve') {
    const port = a.port ?? 8765;
    const { server, tokenFile } = await startApi({ ...ctx, anywhere: false, write: a.write }, version, port);
    const stop = () => server.close(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    io.err(`LV Design Studio local API (${a.write ? 'read and change' : 'read only'}): http://127.0.0.1:${port}/api/tools  — projects folder ${ctx.folder}.`);
    io.err(tokenFile ? `Token (send as Authorization: Bearer <token>): in ${tokenFile}` : 'Token: the one in LVDS_API_TOKEN.');
    io.err('Ctrl+C to stop. "lvds help serve" for an example.');
    return -1;
  }
  const t = toolByName(ALIASES[cmd] ?? cmd);
  if (!t) { io.err(`Unknown command "${cmd}". Run "lvds help".`); return 2; }

  const args: Record<string, unknown> = { ...a.flags };
  if (a.commit) {
    if (!t.writes) { io.err(`${cmd} does not change a project: --apply / --propose / --export do not apply.`); return 2; }
    args.mode = (['propose', 'export', 'apply'] as const).find((m) => 'mode' in t.input && (t.input.mode as z.ZodType).safeParse(m).success);
  }
  const pos = [...a.positional];
  if (t.usesProject && args.project === undefined && pos.length) args.project = pos.shift();
  if (['get_panel', 'move_panel', 'copy_panel'].includes(t.name) && args.panel === undefined && pos.length) args.panel = pos.shift();
  if (['move_panel', 'copy_panel'].includes(t.name) && args.to === undefined && pos.length) args.to = pos.shift();
  if (pos.length) { io.err(`Unexpected "${pos.join(' ')}". Run "lvds help ${cmd}".`); return 2; }
  // A list may also be given as plain text, comma separated: --sheets E-SLD-001,E-SLD-002
  for (const [k, v] of Object.entries(args)) {
    const s = t.input[k] as z.ZodType | undefined;
    if (s && (typeof v === 'string' || typeof v === 'number') && !s.safeParse(v).success) {
      const list = String(v).split(',').map((x) => x.trim()).filter(Boolean);
      if (s.safeParse(list).success) args[k] = list;
    }
  }
  try {
    const result = await callTool(t, args, ctx);
    io.out(a.json ? JSON.stringify(result, null, 2) : formatText(result));
    return t.name === 'run_checks' && (result as { fail: number }).fail > 0 ? 1 : 0;
  } catch (e) {
    io.err(`Error: ${(e as Error).message}`);
    return 2;
  }
}
