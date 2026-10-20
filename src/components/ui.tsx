import { useEffect, useRef, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { STATUS_TEXT } from '../calc/statusText';
import type { Status } from '../calc/electrical';

export const STATUS_LABEL: Record<Status, string> = STATUS_TEXT;

export function StatusCell({ status, children }: { status: Status; children?: ReactNode }) {
  return <td className={status}>{children ?? STATUS_LABEL[status]}</td>;
}

/** Count of pass / check / fail, shown at the top of each study. */
export function StatusCounts({ statuses }: { statuses: Status[] }) {
  const n = (s: Status) => statuses.filter((x) => x === s).length;
  return (
    <span className="counts">
      <span className="ok">{n('ok')} pass</span>
      <span className="warn">{n('warn')} warning</span>
      <span className="bad">{n('bad')} fail</span>
    </span>
  );
}

/** Shown on study results while their inputs changed since the last run. */
export function StaleBanner({ stale, onRun, what }: { stale: string[]; onRun: () => void; what?: string }) {
  if (!stale.length) return null;
  return (
    <div className="stale-banner" role="status">
      <span>⚠ Inputs changed since the last run — {what ?? 'these results'} are out of date ({stale.join(', ')}).</span>
      <button className="chip primary" onClick={onRun}>▶ Run calculations (F5)</button>
    </div>
  );
}

/** Page scaffold for a study or document: title, intro, action buttons. */
export function Page({ title, intro, actions, children }: { title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <section className="stage">
        <div className="stage-head">
          <h3>{title}</h3>
          {actions && <div>{actions}</div>}
        </div>
        {intro && <p className="m intro">{intro}</p>}
      </section>
      <div className="tw">{children}</div>
    </>
  );
}

export function NumberSetting({ label, value, step = 1, min, max, suffix, onChange }: {
  label: string; value: number; step?: number; min?: number; max?: number; suffix?: string; onChange: (v: number) => void;
}) {
  return (
    <label className="setting">
      {label}
      <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => e.target.value !== '' && onChange(+e.target.value)} />
      {suffix && <span className="m">{suffix}</span>}
    </label>
  );
}

/** Labelled number box that commits on Enter / leaving the box (typing
 * "0." never fights the value); blank = the placeholder default when
 * `optional`, otherwise ignored. */
export function NumField({ label, value, unit, onSet, placeholder, optional, width = 80, title, min, max }: {
  label: string;
  value?: number;
  unit?: string;
  onSet: (v: number | undefined) => void;
  placeholder?: string;
  optional?: boolean;
  width?: number;
  title?: string;
  min?: number;
  max?: number;
}) {
  const commit = (t: string, el: HTMLInputElement) => {
    const s = t.trim().replace(',', '.');
    if (s === '') { if (optional) onSet(undefined); else el.value = value === undefined ? '' : String(value); return; }
    let n = Number(s);
    if (!Number.isFinite(n)) { el.value = value === undefined ? '' : String(value); return; }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== value) onSet(n);
    el.value = String(n);
  };
  return (
    <label className="nf" title={title}>
      <span>{label}</span>
      <span className="nf-in">
        <input
          key={`${value ?? ''}`}
          inputMode="decimal"
          style={{ width }}
          defaultValue={value ?? ''}
          placeholder={placeholder}
          onBlur={(e) => commit(e.target.value, e.target)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  );
}

/** A study page filtered to one board and the boards below it (picked in the panel tree). */
export function FocusChip({ id, onClear }: { id?: string | null; onClear?: () => void }) {
  if (!id) return null;
  return (
    <span className="focus-chip" title="Picked in the panel tree">
      Showing <b>{id}</b> and below
      {onClear && <button className="icon-btn" onClick={onClear} title="Show all boards">✕</button>}
    </span>
  );
}

/** Open dialogs, newest last: Escape closes only the top one. */
const openModals: object[] = [];

/** A dialog over the page: a backdrop click or Escape closes it. A form when onSubmit is given. */
export function Modal({ onClose, onSubmit, className = 'modal', style, role = 'dialog', label, children }: {
  onClose: () => void; onSubmit?: (e: FormEvent<HTMLFormElement>) => void; className?: string; style?: CSSProperties;
  role?: 'dialog' | 'alertdialog'; label?: string; children: ReactNode;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const me = {};
    openModals.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || openModals[openModals.length - 1] !== me) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); openModals.splice(openModals.indexOf(me), 1); };
  }, []);
  const box = { className, style, role, 'aria-modal': true, 'aria-label': label, onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      {onSubmit ? <form {...box} onSubmit={onSubmit}>{children}</form> : <div {...box}>{children}</div>}
    </div>
  );
}
