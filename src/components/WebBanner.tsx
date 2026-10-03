import { useState } from 'react';
import { Download, MonitorDown, X } from 'lucide-react';
import { DOWNLOAD_URL, useWebApp } from '../util/webApp';

/** The web version's strip: what it is, Install app (when the browser
 * offers it), offline readiness, and the desktop download. */
export default function WebBanner() {
  const { offline, canInstall, installed, install } = useWebApp();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('lvds.webBanner') === 'hidden'; } catch { return false; } });
  if (hidden) return null;
  return (
    <div className="web-banner" role="note">
      <span>
        <b>{installed ? 'LV Design Studio (browser app).' : 'Trying LV Design Studio in your browser.'}</b>{' '}
        Projects stay on this computer — use <b>Download file</b> to keep a copy. Full PDF reports, the Excel database and engine comparison are in the desktop app.
      </span>
      <span className="sp" />
      {offline === 'ready' && <span className="m web-ok" title="Everything this version needs is stored on this computer">✓ Ready for offline use</span>}
      {offline === 'preparing' && <span className="m">Preparing for offline use…</span>}
      {offline === 'failed' && <span className="m warn" title="Reload when online to try again">Offline use not ready</span>}
      {canInstall && !installed && <button className="chip" onClick={install} title="Install as an app with its own window and icon"><MonitorDown size={14} /> Install app</button>}
      {DOWNLOAD_URL && <a className="chip primary" href={DOWNLOAD_URL} target="_blank" rel="noreferrer"><Download size={14} /> Download desktop app</a>}
      <button className="icon-btn" title="Hide for now" onClick={() => { setHidden(true); try { sessionStorage.setItem('lvds.webBanner', 'hidden'); } catch { /* preference only */ } }}><X size={14} /></button>
    </div>
  );
}
