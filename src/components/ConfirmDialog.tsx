import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from './ui';

/** A question for the user in place of the browser's confirm() / alert(). */
export interface Ask {
  title: string;
  /** Detail under the title: what will happen, what is affected. */
  message?: ReactNode;
  /** The action, in words ("Delete MDB-1"); default "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive: red button, and focus starts on Cancel. */
  danger?: boolean;
  /** Only an OK button (in place of alert()). */
  notice?: boolean;
}

type Pending = Ask & { id: number; resolve: (ok: boolean) => void };
let nextId = 0;
let show: ((p: Pending) => void) | null = null;

const DESTRUCTIVE = /^(delete|remove|clear|discard|replace|overwrite|empty|restore|leave|start again|re-plan|go back)\b/i;

/** A question written as one string ("Delete MDB-1? Its feeders go too.") as a dialog:
 * the first question is the title, the rest the detail; the title's first word labels
 * the button, and destructive verbs make it a red button with focus on Cancel. */
export function fromText(text: string): Ask {
  const m = /^([\s\S]*?\?)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const title = (m ? m[1] : text).trim(), message = m?.[2]?.trim() || undefined;
  const verb = /^(Delete|Remove|Clear|Discard|Replace|Overwrite|Restore|Leave|Bring|Create|Export|Reopen|Go back|Start again)\b/.exec(title)?.[1];
  return { title, message, confirmLabel: verb, danger: DESTRUCTIVE.test(title) };
}

/** Asks and resolves true when the user confirms. Without a mounted <ConfirmHost>
 * (tests, the command line) it falls back to the browser's own dialogs. */
export function ask(question: Ask | string): Promise<boolean> {
  const q = typeof question === 'string' ? fromText(question) : question;
  if (show) { const s = show; return new Promise((resolve) => s({ ...q, id: ++nextId, resolve })); }
  const text = [q.title, typeof q.message === 'string' ? q.message : ''].filter(Boolean).join('\n\n');
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (q.notice) { window.alert?.(text); return Promise.resolve(true); }
  return Promise.resolve(!!window.confirm?.(text));
}

/** A message with an OK button, in place of alert(). */
export const tell = (title: string, message?: ReactNode) => ask({ title, message, notice: true }).then(() => undefined);

export function ConfirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger, notice, onAnswer }: Ask & { onAnswer: (ok: boolean) => void }) {
  return (
    <Modal onClose={() => onAnswer(false)} role="alertdialog" labelledBy="confirm-title" className="modal confirm-dialog">
      <h3 id="confirm-title">{title}</h3>
      {message && <div className="confirm-msg">{message}</div>}
      <div className="modal-actions">
        {!notice && <button type="button" className="chip" onClick={() => onAnswer(false)}>{cancelLabel}</button>}
        <button type="button" className={`chip ${danger ? 'bad-btn' : 'primary'}`} autoFocus={!danger} onClick={() => onAnswer(true)}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

/** Mount once (App): shows the questions asked with ask() / tell(), one at a time. */
export function ConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  useEffect(() => {
    show = (p) => setQueue((q) => [...q, p]);
    return () => { show = null; };
  }, []);
  const top = queue[0];
  if (!top) return null;
  const { resolve, id, ...q } = top;
  return <ConfirmDialog key={id} {...q} onAnswer={(ok) => { setQueue((l) => l.slice(1)); resolve(ok); }} />;
}
