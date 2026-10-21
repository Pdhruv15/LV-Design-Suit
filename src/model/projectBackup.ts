import type { Project } from '../types';
import type { Checkpoint } from './checkpoints';

/** A portable backup of one project: the project, its checkpoints (which otherwise stay on one computer) and a manifest
 * with a SHA-256 check of every file, in one zip named "<project>.lvds-backup". Import verifies everything before
 * anything is opened. */
export const BACKUP_FORMAT = 'lvds-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_EXT = 'lvds-backup';
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 500;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  project: { id?: string; name: string; schemaVersion?: number };
  files: { path: string; bytes: number; sha256: string }[];
}

export interface ReadBackup { manifest: BackupManifest; project: Project; checkpoints: Checkpoint[] }

const enc = new TextEncoder();
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'file';

/** The backup zip for a project and its checkpoints. */
export async function buildBackup(project: Project, checkpoints: Checkpoint[], appVersion: string, now = new Date()): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const files: BackupManifest['files'] = [];
  const add = async (path: string, value: unknown) => {
    const bytes = enc.encode(JSON.stringify(value));
    zip.file(path, bytes);
    files.push({ path, bytes: bytes.length, sha256: await sha256(bytes) });
  };
  await add('project.json', project);
  for (const c of [...checkpoints].sort((a, b) => a.at.localeCompare(b.at))) await add(`checkpoints/${safe(c.id)}.json`, c);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, appVersion, exportedAt: now.toISOString(),
    project: { ...(project.id ? { id: project.id } : {}), name: project.name, ...(project.schemaVersion !== undefined ? { schemaVersion: project.schemaVersion } : {}) },
    files
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Reads and verifies a backup: the manifest, every listed file's size and SHA-256, a project that looks like a project,
 * and checkpoints that belong to it. Throws a plain message on the first problem; nothing is opened before it passes. */
export async function readBackup(bytes: Uint8Array): Promise<ReadBackup> {
  if (bytes.length > MAX_BACKUP_BYTES) throw new Error('The backup is larger than 200 MB.');
  const JSZip = (await import('jszip')).default;
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('This is not an LV Design Studio backup (not a zip file).'); }
  if (Object.keys(zip.files).length > MAX_FILES + 1) throw new Error('The backup holds too many files.');
  const mf = zip.file('manifest.json');
  if (!mf) throw new Error('This is not an LV Design Studio backup (no manifest).');
  let manifest: BackupManifest;
  try { manifest = JSON.parse(await mf.async('string')); } catch { throw new Error('The backup manifest is damaged.'); }
  if (!isObj(manifest) || manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.files)) throw new Error('This is not an LV Design Studio backup.');
  if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error(`This backup was made by a newer LV Design Studio (${String(manifest.appVersion)}); update the app to open it.`);
  }
  const contents = new Map<string, unknown>();
  for (const f of manifest.files) {
    if (!isObj(f) || typeof f.path !== 'string' || typeof f.sha256 !== 'string') throw new Error('The backup manifest is damaged.');
    const entry = zip.file(f.path);
    if (!entry) throw new Error(`The backup is missing ${f.path}.`);
    const data = await entry.async('uint8array');
    if (data.length !== f.bytes || (await sha256(data)) !== f.sha256) throw new Error(`${f.path} in the backup is damaged (its check does not match).`);
    try { contents.set(f.path, JSON.parse(new TextDecoder().decode(data))); } catch { throw new Error(`${f.path} in the backup is not readable.`); }
  }
  const project = contents.get('project.json');
  if (!isObj(project) || !Array.isArray(project.boards) || !Array.isArray(project.feeders)) throw new Error('The backup holds no LV Design Studio project.');
  const checkpoints = [...contents.entries()]
    .filter(([path]) => path.startsWith('checkpoints/'))
    .map(([, c]) => c)
    .filter((c): c is Checkpoint => isObj(c) && typeof c.id === 'string' && typeof c.at === 'string' && isObj(c.project) && c.projectId === (project as unknown as Project).id);
  return { manifest, project: project as unknown as Project, checkpoints };
}

/** Copies of the checkpoints for another project id (a backup opened as a new project keeps its history). Each copy gets
 * its own id — checkpoints are stored by id, so reusing one would move the original project's checkpoint instead. */
export const checkpointsFor = (list: Checkpoint[], projectId: string): Checkpoint[] =>
  list.map((c) => ({ ...c, id: `${c.id}-${projectId.slice(0, 8)}`, projectId }));
