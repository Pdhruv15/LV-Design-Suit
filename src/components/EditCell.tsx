import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** Parses a typed number: digits with an optional decimal point or comma.
 * Returns null for anything else (empty, letters, two points…). */
export function parseNumber(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  return Number(t);
}

type Props = {
  /** Shown when not editing. */
  display: ReactNode;
  title?: string;
  /** Not editable: shows the value plus the reason as a tooltip. */
  locked?: string;
  className?: string;
} & (
  | { kind: 'number'; value: number; min?: number; max?: number; onCommit: (v: number) => void }
  | { kind: 'text'; value: string; onCommit: (v: string) => void }
  | { kind: 'select'; value: string; options: { value: string; label: string }[]; onCommit: (v: string) => void }
);

/** A table cell edited in place: double-click (or Enter / F2) to edit,
 * Enter or clicking away to keep the value, Esc to cancel. Numbers are
 * typed as plain text — no spinner arrows and no leading 0 to delete. */
export default function EditCell(p: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const editing = draft !== null;

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    if (p.kind !== 'select') input.current?.select();
  }, [editing]);

  const invalid = (() => {
    if (!editing || p.kind !== 'number') return '';
    const v = parseNumber(draft);
    if (v === null) return 'Enter a number';
    if (p.min !== undefined && v < p.min) return `Minimum ${p.min}`;
    if (p.max !== undefined && v > p.max) return `Maximum ${p.max}`;
    return '';
  })();

  function start() {
    if (p.locked) return;
    setDraft(String(p.value ?? ''));
  }

  function commit(value = draft) {
    if (value === null) return;
    if (p.kind === 'number') {
      const v = parseNumber(value);
      const ok = v !== null && !invalid;
      setDraft(null);
      if (ok && v !== p.value) p.onCommit(v);
      return;
    }
    setDraft(null);
    if (value !== p.value) p.onCommit(value.trim() === '' && p.kind === 'text' ? '' : value);
  }

  const cls = ['ec', p.locked ? 'locked' : 'editable', editing ? 'editing' : '', p.className ?? ''].join(' ').trim();

  if (!editing) {
    return (
      <td
        className={cls}
        title={p.locked ?? p.title ?? 'Double-click to edit'}
        tabIndex={p.locked ? undefined : 0}
        onDoubleClick={start}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'F2') && (e.preventDefault(), start())}
      >
        {p.display}
      </td>
    );
  }

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
  };

  return (
    <td className={cls}>
      {p.kind === 'select' ? (
        <select ref={input} value={draft} onChange={(e) => commit(e.target.value)} onBlur={() => setDraft(null)} onKeyDown={keys}>
          {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          ref={input}
          type="text"
          inputMode={p.kind === 'number' ? 'decimal' : undefined}
          value={draft}
          aria-invalid={!!invalid}
          title={invalid || undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={keys}
        />
      )}
      {invalid && <span className="ec-err">{invalid}</span>}
    </td>
  );
}
