import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type MutableRefObject, type ReactNode, type Ref } from 'react';
import { Play, X } from 'lucide-react';
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

/** Summary cards above a study's table: the worst case, the limit, the counts. One pattern for every study. */
export function ResultCards({ children }: { children: ReactNode }) {
  return <div className="result-cards">{children}</div>;
}

/** One summary figure. A status colours the value and adds its word (PASS / WARNING / FAIL), never colour alone;
 * with onClick the card is a link (e.g. to the worst circuit). */
export function ResultCard({ label, value, sub, status, onClick, title }: { label: string; value: ReactNode; sub?: ReactNode; status?: Status; onClick?: () => void; title?: string }) {
  return (
    <button type="button" className={`dash-tile result-card${onClick ? ' link' : ''}`} onClick={onClick} disabled={!onClick} title={title}>
      <span className="dash-label">{label}</span>
      <span className="result-value">
        <span className={`dash-value ${status ?? ''}`}>{value}</span>
        {status && <span className={`result-status ${status}`}>{STATUS_LABEL[status]}</span>}
      </span>
      {sub && <span className="dash-sub">{sub}</span>}
    </button>
  );
}

/** Shown on study results while their inputs changed since the last run. */
export function StaleBanner({ stale, onRun, what }: { stale: string[]; onRun: () => void; what?: string }) {
  if (!stale.length) return null;
  return (
    <div className="stale-banner" role="status">
      <span>⚠ Inputs changed since the last run — {what ?? 'these results'} are out of date ({stale.join(', ')}).</span>
      <button className="chip primary" onClick={onRun}><Play size={12} aria-hidden /> Run calculations (F5)</button>
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

/** What a typed number must be; exclusive bounds for "more than 0" style limits. */
export interface NumRule { min?: number; max?: number; minExclusive?: boolean; maxExclusive?: boolean; unit?: string }

const fmt = (n: number) => String(n).replace('-', '−');
/** The rule in words, e.g. "0 to 100 %", "more than 0 %", "0 or more m²". */
export function ruleText({ min, max, minExclusive, maxExclusive, unit }: NumRule): string {
  const u = unit ? ` ${unit}` : '';
  if (min !== undefined && max !== undefined) return minExclusive || maxExclusive ? `more than ${fmt(min)} and less than ${fmt(max)}${u}` : `${fmt(min)} to ${fmt(max)}${u}`;
  if (min !== undefined) return minExclusive ? `more than ${fmt(min)}${u}` : `${fmt(min)} or more${u}`;
  if (max !== undefined) return maxExclusive ? `less than ${fmt(max)}${u}` : `${fmt(max)} or less${u}`;
  return 'a number';
}

/** Checks typed text ("1,250", "12,50,000", "0,8" and "−5" are read as numbers). Nothing is clamped:
 * a value outside the rule is an error in words, shown under the field. */
export function checkNumber(text: string, rule: NumRule = {}): { value?: number; error?: string } {
  const t = text.trim().replace(/[−–]/g, '-');
  // Commas: digit grouping (1,250 · 12,50,000) unless a single one reads as a decimal point (0,8).
  const commas = (t.match(/,/g) ?? []).length;
  const s = commas > 1 || /,\d{3}(\.|$)/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  const n = s === '' ? NaN : Number(s);
  if (!Number.isFinite(n)) return { error: rule.min !== undefined || rule.max !== undefined ? `Enter ${ruleText(rule)}` : 'Enter a number' };
  const { min, max, minExclusive, maxExclusive } = rule;
  const low = min !== undefined && (minExclusive ? n <= min : n < min), high = max !== undefined && (maxExclusive ? n >= max : n > max);
  return low || high ? { error: `Enter ${ruleText(rule)}` } : { value: n };
}

/** A number box that saves when you leave it (or press Enter). Text that is not a valid
 * number stays in the box with a message under it, and nothing is saved until it is fixed. */
export function CheckedNum({ value, shown, onSet, rule, className = 'bi-num', width, title, label }: {
  value?: number; shown?: string; onSet: (v: number) => void; rule?: NumRule; className?: string; width?: number; title?: string; label?: string;
}) {
  const [error, setError] = useState<string>();
  const id = useId();
  const text = shown ?? (value === undefined ? '' : String(value));
  return (
    <span className={`field${error ? ' has-error' : ''}`}>
      <input className={className} style={width ? { width } : undefined} inputMode="decimal" defaultValue={text} key={text} title={title} aria-label={label}
        aria-invalid={error ? true : undefined} aria-describedby={error ? id : undefined}
        onChange={() => error && setError(undefined)}
        onBlur={(e) => {
          if (e.target.value.trim() === text.trim()) { setError(undefined); return; }
          const r = checkNumber(e.target.value, rule);
          setError(r.error);
          if (r.value !== undefined && r.value !== value) onSet(r.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape' && error) { e.preventDefault(); (e.target as HTMLInputElement).value = text; setError(undefined); }
        }} />
      {error && <span className="field-error" id={id} role="alert">{error}</span>}
    </span>
  );
}

/** A study page filtered to one board and the boards below it (picked in the panel tree). */
export function FocusChip({ id, onClear }: { id?: string | null; onClear?: () => void }) {
  if (!id) return null;
  return (
    <span className="focus-chip" title="Picked in the panel tree">
      Showing <b>{id}</b> and below
      {onClear && <button className="icon-btn" onClick={onClear} title="Show all boards" aria-label="Show all boards"><X size={14} aria-hidden /></button>}
    </span>
  );
}

/** Open dialogs, newest last: Escape closes only the top one. */
const openModals: object[] = [];

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Tab stops in the dialog; with layout (not in tests), only the visible ones (e.g. not inside a closed <details>). */
const focusables = (box: HTMLElement) => {
  const laidOut = box.getClientRects().length > 0;
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden],[inert]') && (!laidOut || el.getClientRects().length > 0));
};

/** A dialog over the page: a backdrop click or Escape closes it. A form when onSubmit is given.
 * Focus moves into the dialog (an autoFocus field wins), Tab stays inside it, and closing
 * returns focus to whatever opened it. */
export function Modal({ onClose, onSubmit, className = 'modal', style, role = 'dialog', label, labelledBy, backdropClassName, closeOnBackdrop = true, boxRef, children }: {
  onClose: () => void; onSubmit?: (e: FormEvent<HTMLFormElement>) => void; className?: string; style?: CSSProperties;
  role?: 'dialog' | 'alertdialog'; label?: string; labelledBy?: string; backdropClassName?: string;
  /** False for long tasks where a stray click must not throw the work away. */
  closeOnBackdrop?: boolean;
  /** The dialog box element (e.g. to focus a particular field). */
  boxRef?: Ref<HTMLFormElement & HTMLDivElement> | Ref<HTMLFormElement> | Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  const ref = useRef<HTMLElement | null>(null);
  // Who had focus before the dialog: read while rendering, as an autoFocus field takes focus before effects run.
  const [opener] = useState(() => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const setBox = (el: HTMLElement | null) => {
    ref.current = el;
    if (typeof boxRef === 'function') (boxRef as (e: HTMLElement | null) => void)(el);
    else if (boxRef) (boxRef as MutableRefObject<HTMLElement | null>).current = el;
  };
  useEffect(() => {
    const me = {};
    openModals.push(me);
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) (focusables(box)[0] ?? box).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || openModals[openModals.length - 1] !== me) return;
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab' || !box) return;
      const list = focusables(box);
      if (!list.length) { e.preventDefault(); box.focus(); return; }
      const first = list[0], last = list[list.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || !box.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !box.contains(at))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      openModals.splice(openModals.indexOf(me), 1);
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);
  const box = {
    className, style, role, tabIndex: -1, 'aria-modal': true, 'aria-label': labelledBy ? undefined : label, 'aria-labelledby': labelledBy,
    onClick: (e: { stopPropagation: () => void }) => e.stopPropagation()
  };
  return (
    <div className={`modal-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}`} onClick={closeOnBackdrop ? onClose : undefined}>
      {onSubmit
        ? <form {...box} ref={setBox} onSubmit={onSubmit}>{children}</form>
        : <div {...box} ref={setBox}>{children}</div>}
    </div>
  );
}
