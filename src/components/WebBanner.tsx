import { useState } from 'react';
import { CircleCheck, Download, MonitorDown, RefreshCw, X } from 'lucide-react';
import { DOWNLOAD_URL, useWebApp } from '../util/webApp';

/** The web version's strip: what it is, Install app (when the browser
 * offers it), offline readiness, Reload when a newer version is ready,
 * and the desktop download. Hidden for now, it comes back for a new version. */
export default function WebBanner() {
  const { offline, canInstall, installed, install, newVersion } = useWebApp();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('lvds.webBanner') === 'hidden'; } catch { return false; } });
  if (hidden && newVersion === null) return null;
  return (
    <div className="web-banner" role="note">
      <span>
        <b>{installed ? 'LV Design Studio (browser app).' : 'Trying LV Design Studio in your browser.'}</b>{' '}
        Projects stay on this computer — use <b>Download file</b> to keep a copy. Full PDF reports, the Excel database and engine comparison are in the desktop app.
      </span>
      <span className="sp" />
      {newVersion !== null && <button className="chip primary" onClick={() => location.reload()} title="A newer version is downloaded. Reload to use it; download any unsaved project first"><RefreshCw size={14} /> New version{newVersion ? ` ${newVersion}` : ''} — reload</button>}
      {offline === 'ready' && newVersion === null && <span className="m web-ok" title="Everything this version needs is stored on this computer"><CircleCheck size={13} aria-hidden /> Ready for offline use</span>}
      {offline === 'preparing' && <span className="m">Preparing for offline use…</span>}
      {offline === 'failed' && <span className="m warn" title="Reload when online to try again">Offline use not ready</span>}
      {canInstall && !installed && <button className="chip" onClick={install} title="Install as an app with its own window and icon"><MonitorDown size={14} /> Install app</button>}
      {DOWNLOAD_URL && <a className="chip primary" href={DOWNLOAD_URL} target="_blank" rel="noreferrer"><Download size={14} /> Download desktop app</a>}
      <button className="icon-btn" title="Hide for now" aria-label="Hide for now" onClick={() => { setHidden(true); try { sessionStorage.setItem('lvds.webBanner', 'hidden'); } catch { /* preference only */ } }}><X size={14} /></button>
    </div>
  );
}
