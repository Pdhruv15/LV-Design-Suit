import { useEffect, useState } from 'react';
import type { Project } from '../types';
import { safeFileName } from './files';

/** The web version (not the desktop app): offline preparation, "Install
 * app", and project files the user keeps on their own computer — there is
 * no cloud storage. */

export const isWebVersion = () => typeof window !== 'undefined' && !window.lvds;

/** Where the desktop app is downloaded (set at build time: VITE_DOWNLOAD_URL). */
export const DOWNLOAD_URL: string = (import.meta.env.VITE_DOWNLOAD_URL as string | undefined) ?? '';

export type OfflineState = 'unsupported' | 'preparing' | 'ready' | 'failed';

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPrompt; listeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });
}
const standalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

/** Offline state and the browser's install prompt (Chrome / Edge). */
export function useWebApp(): { offline: OfflineState; canInstall: boolean; installed: boolean; install: () => Promise<void> } {
  const [offline, setOffline] = useState<OfflineState>('unsupported');
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  useEffect(() => {
    // Only the built web version over http(s): not the dev server, not the desktop app.
    if (!isWebVersion() || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || import.meta.env.DEV) return;
    setOffline('preparing');
    navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => setOffline('ready')).catch(() => setOffline('failed'));
  }, []);
  return {
    offline, canInstall: !!deferred, installed: standalone(),
    install: async () => { if (!deferred) return; await deferred.prompt(); await deferred.userChoice; deferred = null; bump((n) => n + 1); }
  };
}

/** Download the project as a file (the same .json the desktop app opens). */
export function downloadProjectFile(project: Project): string {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeFileName(project.name || 'project')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return `Downloaded ${a.download} — keep it safe; open it here or in the desktop app`;
}

/** Choose a project file from this computer. */
export function chooseProjectFile(): Promise<{ project: Project; name: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        const p = JSON.parse(await f.text()) as Project;
        if (!p || !Array.isArray(p.boards) || !Array.isArray(p.feeders)) throw new Error(`${f.name} is not an LV Design Studio project`);
        resolve({ project: p, name: f.name });
      } catch (e) { reject(e); }
    };
    input.click();
  });
}
