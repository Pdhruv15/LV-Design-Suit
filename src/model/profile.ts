import { STUDY_DEFAULTS, type DrawingInfo, type Project, type StudySettings } from '../types';

/** The user of this computer: their details go on every new project's
 * drawings and reports, and their design defaults start every new project.
 * Kept on this computer (like the feeder presets); the project file keeps
 * its own copy of what was filled in. */

export interface UserProfile {
  name?: string;
  designation?: string; // e.g. Electrical Design Engineer
  company?: string;
  phone?: string;
  email?: string;
  /** Company logo as a data: URL (PNG / JPEG, scaled down), for title blocks and report covers. */
  logo?: string;
  /** Usual checker / approver, filled into new drawings. */
  checkedBy?: string;
  approvedBy?: string;
}

/** What a new project starts with. Anything left out uses the app's default. */
export interface DesignDefaults {
  voltageV?: number;
  frequencyHz?: number;
  ambientC?: number;
  vdLimitPct?: number;
  studySettings?: StudySettings;
  sheet?: DrawingInfo['sheet'];
  symbols?: DrawingInfo['symbols'];
  pointTemplate?: string;
  autoRun?: boolean;
}

export interface AppPrefs {
  /** Minutes between recovery copies of unsaved work; 0 = off. */
  autosaveMin: number;
}

export interface Preferences {
  profile: UserProfile;
  defaults: DesignDefaults;
  app: AppPrefs;
}

export const DEFAULT_PREFS: Preferences = { profile: {}, defaults: {}, app: { autosaveMin: 2 } };

const KEY = 'lvds.preferences';

export function loadPrefs(): Preferences {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Preferences> | null;
    if (!v || typeof v !== 'object') return DEFAULT_PREFS;
    return { profile: v.profile ?? {}, defaults: v.defaults ?? {}, app: { ...DEFAULT_PREFS.app, ...v.app } };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** False when this computer's storage refused it (e.g. a very large logo). */
export function savePrefs(p: Preferences): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/** Only the fields that have a value. */
const clean = <T extends object>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as { [K in keyof T]?: Exclude<T[K], undefined> };

/** "Name, Designation" for "Prepared by" lines. */
export const signature = (u: UserProfile) => [u.name, u.designation].filter(Boolean).join(', ');

export const initialsOf = (name = '') => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

/** A new project with the user's design defaults and details. */
export function applyDefaults(p: Project, prefs: Preferences): Project {
  const d = prefs.defaults;
  const next: Project = {
    ...p,
    ...clean({ voltageV: d.voltageV, frequencyHz: d.frequencyHz, ambientC: d.ambientC, vdLimitPct: d.vdLimitPct, pointTemplate: d.pointTemplate }),
    studySettings: d.studySettings ? { ...p.studySettings, ...clean(d.studySettings) } : p.studySettings,
    calc: d.autoRun ? { ...p.calc, autoRun: true } : p.calc,
    drawing: { ...p.drawing, ...clean({ sheet: d.sheet, symbols: d.symbols }) },
    createdBy: prefs.profile.name || p.createdBy
  };
  return applyProfile(next, prefs.profile, false);
}

/** Fill the project's title block and report "prepared by" from the
 * profile. overwrite: replace what's there (the "use my details" button);
 * otherwise only fill blanks. */
export function applyProfile(p: Project, u: UserProfile, overwrite: boolean): Project {
  const pick = <T,>(cur: T | undefined, mine: T | undefined) => (overwrite ? mine ?? cur : cur ?? mine) || undefined;
  const d = p.drawing ?? {};
  const drawing: DrawingInfo = clean({
    ...d,
    company: pick(d.company, u.company),
    drawnBy: pick(d.drawnBy, u.name),
    checkedBy: pick(d.checkedBy, u.checkedBy),
    approvedBy: pick(d.approvedBy, u.approvedBy),
    logo: pick(d.logo, u.logo)
  });
  const sr = p.studyReport;
  const studyReport = sr
    ? { ...sr, preparedBy: pick(sr.preparedBy, signature(u) || undefined), checkedBy: pick(sr.checkedBy, u.checkedBy) }
    : undefined;
  return { ...p, drawing, ...(studyReport ? { studyReport } : {}) };
}

/** The current project's design basis as defaults for new projects. */
export function defaultsFromProject(p: Project): DesignDefaults {
  return {
    voltageV: p.voltageV,
    frequencyHz: p.frequencyHz,
    ambientC: p.ambientC,
    vdLimitPct: p.vdLimitPct,
    studySettings: { ...STUDY_DEFAULTS, ...p.studySettings },
    sheet: p.drawing?.sheet,
    symbols: p.drawing?.symbols,
    pointTemplate: p.pointTemplate,
    autoRun: !!p.calc?.autoRun
  };
}

/** Scale a picked image down (max 480 × 160 px) to keep the file small. */
export function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 480 / img.width, 160 / img.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image')); };
    img.src = url;
  });
}
