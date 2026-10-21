import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
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

/** One text field of a form dialog. */
export interface AskField {
  key: string;
  label: string;
  initial?: string;
  placeholder?: string;
  /** Save stays blocked until it has text (a message under the field says so). */
  required?: boolean;
  /** A text area (Enter makes a new line; Ctrl+Enter / ⌘Enter saves). */
  multiline?: boolean;
  /** Shown under the field. */
  hint?: string;
  /** A choice from a list instead of free text (the first one is preselected unless `initial` names another). */
  options?: string[];
}

/** A small form in place of one or several prompt() calls. */
export interface AskFormSpec { title: string; message?: ReactNode; fields: AskField[]; confirmLabel?: string; cancelLabel?: string }

type Pending =
  | (Ask & { kind: 'confirm'; id: number; resolve: (ok: boolean) => void })
  | (AskFormSpec & { kind: 'form'; id: number; resolve: (values: Record<string, string> | null) => void });
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
  if (show) { const s = show; return new Promise((resolve) => s({ ...q, kind: 'confirm', id: ++nextId, resolve })); }
  const text = [q.title, typeof q.message === 'string' ? q.message : ''].filter(Boolean).join('\n\n');
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (q.notice) { window.alert?.(text); return Promise.resolve(true); }
  return Promise.resolve(!!window.confirm?.(text));
}

/** A message with an OK button, in place of alert(). */
export const tell = (title: string, message?: ReactNode) => ask({ title, message, notice: true }).then(() => undefined);

/** Asks for one or more texts and resolves with them (trimmed), or null when cancelled — like prompt(),
 * in one in-app form. Without a mounted <ConfirmHost> it falls back to one prompt() per field. */
export function askForm(spec: AskFormSpec): Promise<Record<string, string> | null> {
  if (show) { const s = show; return new Promise((resolve) => s({ ...spec, kind: 'form', id: ++nextId, resolve })); }
  if (typeof window === 'undefined' || !window.prompt) return Promise.resolve(null);
  const out: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = window.prompt(f.options ? `${f.label} (${f.options.join(', ')})` : f.label, f.initial ?? f.options?.[0] ?? '');
    if (v === null || (f.required && !v.trim())) return Promise.resolve(null);
    out[f.key] = v.trim();
  }
  return Promise.resolve(out);
}

/** One text, or null when cancelled (in place of prompt()). */
export const askText = (title: string, field: Omit<AskField, 'key'> & { confirmLabel?: string; message?: ReactNode }) =>
  askForm({ title, message: field.message, confirmLabel: field.confirmLabel, fields: [{ ...field, key: 'v' }] }).then((r) => (r ? r.v : null));

export function FormDialog({ title, message, fields, confirmLabel = 'Save', cancelLabel = 'Cancel', onAnswer }: AskFormSpec & { onAnswer: (values: Record<string, string> | null) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.initial ?? f.options?.[0] ?? ''])));
  const [tried, setTried] = useState(false);
  const base = useId();
  const missing = (f: AskField) => !!f.required && !values[f.key]?.trim();
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setTried(true);
    if (fields.some(missing)) return;
    onAnswer(Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? '').trim()])));
  };
  return (
    <Modal onClose={() => onAnswer(null)} onSubmit={submit} labelledBy={`${base}-t`} className="modal form-dialog">
      <h3 id={`${base}-t`}>{title}</h3>
      {message && <div className="confirm-msg">{message}</div>}
      {fields.map((f, i) => {
        const err = tried && missing(f) ? 'Required' : undefined;
        const id = `${base}-${f.key}`;
        const common = {
          id, value: values[f.key] ?? '', placeholder: f.placeholder, autoFocus: i === 0,
          'aria-invalid': err ? true : undefined, 'aria-describedby': err ? `${id}-e` : f.hint ? `${id}-h` : undefined,
          onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [f.key]: e.target.value }))
        };
        return (
          <div key={f.key} className="form-field">
            <label htmlFor={id}>{f.label}{!f.required && <span className="m"> (optional)</span>}</label>
            {f.options
              ? <select id={id} value={values[f.key] ?? ''} autoFocus={i === 0} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              : f.multiline
              ? <textarea rows={3} {...common} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }} />
              : <input {...common} />}
            {err ? <span className="field-error" id={`${id}-e`} role="alert">{err}</span> : f.hint && <span className="m form-hint" id={`${id}-h`}>{f.hint}</span>}
          </div>
        );
      })}
      <div className="modal-actions">
        <button type="button" className="chip" onClick={() => onAnswer(null)}>{cancelLabel}</button>
        <button type="submit" className="chip primary">{confirmLabel}</button>
      </div>
    </Modal>
  );
}

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

/** Mount once (App): shows the questions asked with ask() / tell() / askForm() / askText(), one at a time. */
export function ConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  useEffect(() => {
    show = (p) => setQueue((q) => [...q, p]);
    return () => { show = null; };
  }, []);
  const top = queue[0];
  if (!top) return null;
  const done = () => setQueue((l) => l.slice(1));
  if (top.kind === 'form') {
    const { resolve, id, kind: _k, ...spec } = top;
    return <FormDialog key={id} {...spec} onAnswer={(v) => { done(); resolve(v); }} />;
  }
  const { resolve, id, kind: _k, ...q } = top;
  return <ConfirmDialog key={id} {...q} onAnswer={(ok) => { done(); resolve(ok); }} />;
}
