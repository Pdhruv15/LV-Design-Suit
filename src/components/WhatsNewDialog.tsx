import { Modal } from './ui';
import type { Release, WhatsNewAction } from '../model/whatsNew';

const ICONS: Record<WhatsNewAction | 'cli', string> = {
  cad: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586',
  'floor-plan': 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  'floor-plan-lengths': 'M4 18c4 0 4-12 8-12s4 12 8 12',
  'floor-plan-trays': 'M3 9h18v6H3zM7 9v6M12 9v6M17 9v6',
  'floor-plan-boards': 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h3',
  cli: 'M4 17l6-6 4 4 6-8'
};

/** What's new: the features the releases added, each with a button that opens it. Shown once after an update, and
 * from Help. */
export default function WhatsNewDialog({ releases, from, onAction, onClose }: {
  releases: Release[];
  /** The version updated from, when known. */
  from?: string;
  onAction: (a: WhatsNewAction) => void;
  onClose: () => void;
}) {
  const newest = releases[0];
  if (!newest) return null;
  const when = new Date(`${newest.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <Modal onClose={onClose} className="modal whats-new" label="What's new">
      <h3>What's new in v{newest.version}</h3>
      <p className="m">{from ? `Updated from v${from} · ` : ''}{when}</p>
      {releases.map((r) => (
        <div key={r.version}>
          {releases.length > 1 && <h4>v{r.version}</h4>}
          {r.items.map((it) => (
            <div key={it.title} className="wn-item">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[it.action ?? 'cli']} /></svg>
              <div><b>{it.title}</b><span className="m">{it.text}</span></div>
              {it.action ? <button className={`chip${it.actionLabel?.startsWith('Open') ? ' primary' : ''}`} onClick={() => onAction(it.action!)}>{it.actionLabel ?? 'Show me'}</button> : <span />}
            </div>
          ))}
        </div>
      ))}
      <div className="modal-actions">
        <span className="m">Also in Help → What's new</span>
        <span className="sp" />
        <button className="chip" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
