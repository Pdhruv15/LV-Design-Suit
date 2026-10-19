import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExportJob } from './rendererExport';

/** Exports that need the app's renderer (drawing sheets as DXF, reports as PDF) run in Electron:
 * electron/headlessExport.cjs, started from the app's source folder (Electron from node_modules and the
 * built app in dist) or through the installed app. The files come back here; nothing is written by Electron. */

export interface Renderer { command: string; args: string[]; where: string }
export interface RendererFile { name: string; about: string; data: Uint8Array }

/** The app folder this lvds belongs to (dist-cli/lvds.mjs or src/headless/*.ts → the folder with package.json). */
function appRoot(): string | undefined {
  let dir: string;
  try { dir = path.dirname(fileURLToPath(import.meta.url)); } catch { return undefined; }
  for (let i = 0; i < 4; i++, dir = path.dirname(dir)) {
    try { if (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).name === 'lv-design-studio') return dir; } catch { /* up */ }
  }
  return undefined;
}

/** Installed app executables, per platform. */
function installedApps(): string[] {
  if (process.platform === 'darwin') return ['/Applications/LV Design Studio.app', path.join(os.homedir(), 'Applications', 'LV Design Studio.app')].map((a) => path.join(a, 'Contents', 'MacOS', 'LV Design Studio'));
  if (process.platform === 'win32') return [path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'lv-design-studio', 'LV Design Studio.exe'), path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LV Design Studio', 'LV Design Studio.exe')];
  return [];
}

/** Whether an installed app's app.asar has the headless export (older versions would open the app window instead). */
export function asarHasHeadlessExport(asar: string): boolean {
  try {
    const fd = fs.openSync(asar, 'r');
    try {
      // Chromium pickle: [4][header size][payload size][string length][JSON header]
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      const len = head.readUInt32LE(12);
      if (len <= 0 || len > 64 * 1024 * 1024) return false;
      const json = Buffer.alloc(len);
      fs.readSync(fd, json, 0, len, 16);
      const header = JSON.parse(json.toString('utf-8')) as { files?: Record<string, { files?: Record<string, unknown> }> };
      return !!header.files?.electron?.files?.['headlessExport.cjs'] && !!header.files?.dist;
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

const asarOf = (exe: string) => (process.platform === 'darwin' ? path.join(exe, '..', '..', 'Resources', 'app.asar') : path.join(path.dirname(exe), 'resources', 'app.asar'));

/** How to run the renderer export, or why it cannot run here. LVDS_ELECTRON: an Electron executable to use with this app folder. */
export function findRenderer(): Renderer | { missing: string } {
  const root = appRoot();
  const script = root && path.join(root, 'electron', 'headlessExport.cjs');
  const built = root && fs.existsSync(path.join(root, 'dist', 'index.html'));
  if (root && script && fs.existsSync(script)) {
    let electron = process.env.LVDS_ELECTRON;
    if (!electron) { try { electron = String(createRequire(path.join(root, 'package.json'))('electron')); } catch { /* not installed */ } }
    if (electron && fs.existsSync(electron)) {
      if (built) return { command: electron, args: [script, '--lvds-headless-export'], where: `Electron in ${root}` };
      return { missing: `the app is not built in ${root}: run "npm run build" first` };
    }
  }
  const app = installedApps().find((exe) => fs.existsSync(exe) && asarHasHeadlessExport(asarOf(exe)));
  if (app) return { command: app, args: ['--lvds-headless-export'], where: `the installed app (${app})` };
  return { missing: 'it needs Electron: run lvds from the LV Design Studio source folder after "npm install" and "npm run build", or install a version of LV Design Studio that has this export' };
}

/** Runs one job in Electron and returns its files. */
export async function runInRenderer(job: ExportJob, renderer: Renderer, timeoutMs = 11 * 60 * 1000): Promise<RendererFile[]> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvds-export-'));
  const jobFile = path.join(tmp, 'job.json'), resultFile = path.join(tmp, 'result.json');
  try {
    fs.writeFileSync(jobFile, JSON.stringify(job));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const { code, stderr } = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(renderer.command, [...renderer.args, jobFile, resultFile], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      let err = '';
      child.stderr.on('data', (d) => { err = (err + String(d)).slice(-4000); });
      const timer = setTimeout(() => { child.kill(); }, timeoutMs);
      child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Could not start ${renderer.where}: ${e.message}`)); });
      child.on('close', (c) => { clearTimeout(timer); resolve({ code: c, stderr: err }); });
    });
    let result: { ok: boolean; error?: string; files?: { name: string; about: string; base64: string }[] } | undefined;
    try { result = JSON.parse(fs.readFileSync(resultFile, 'utf-8')); } catch { /* no result */ }
    if (!result) throw new Error(`The export in ${renderer.where} stopped (exit ${code}) without a result.${stderr.trim() ? ` ${stderr.trim().split(/\r?\n/).slice(-3).join(' ')}` : ''}`);
    if (!result.ok) throw new Error(`The export in ${renderer.where} failed: ${result.error}`);
    return (result.files ?? []).map((f) => ({ name: f.name, about: f.about, data: new Uint8Array(Buffer.from(f.base64, 'base64')) }));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
