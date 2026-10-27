import { X } from 'lucide-react';
import { LOAD_TYPES, type LoadType } from '../../types';
import { RULE_KINDS, type DesignRule, type RuleCategory, type RuleKind } from '../../model/designRules';

const unitOf = (k: RuleKind) => RULE_KINDS.find((x) => x.kind === k)!.unit;
const kindLabel = (k: RuleKind) => RULE_KINDS.find((x) => x.kind === k)!.label;
const CATEGORY: [RuleCategory | '', string][] = [['', 'Any'], ['lighting', 'Lighting'], ['power', 'Power']];
const loadLabel = (t?: LoadType) => LOAD_TYPES.find((x) => x.value === t)?.label ?? 'Any';

/** What a row applies to, as text: "Power · HVAC · from 5 kW". */
export function appliesText(r: DesignRule): string {
  const w = r.when ?? {};
  const parts = [w.category && (w.category === 'lighting' ? 'Lighting' : 'Power'), w.loadType && loadLabel(w.loadType), w.minKw !== undefined && `from ${w.minKw} kW`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'All circuits';
}

export const newRule = (): DesignRule => ({ id: `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind: 'minWireMm2', when: { category: 'power' }, value: 4 });

/** Design rule rows: `fixed` rows are shown read only with where they came from; `rows` can be edited unless readOnly. */
export function RuleRows({ rows, fixed = [], readOnly, onChange, empty }: {
  rows: DesignRule[]; fixed?: DesignRule[]; readOnly?: boolean; onChange?: (rows: DesignRule[]) => void; empty: string;
}) {
  const set = (id: string, patch: Partial<DesignRule>) => onChange?.(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setWhen = (r: DesignRule, patch: Partial<DesignRule['when']>) => {
    const when = { ...r.when, ...patch };
    (Object.keys(when) as (keyof typeof when)[]).forEach((k) => when[k] === undefined && delete when[k]);
    set(r.id, { when });
  };
  return (
    <div className="ref-scroll">
      <table className="compact"><thead><tr><th>Rule</th><th>Circuits</th><th>Load type</th><th className="num">From kW</th><th className="num">Value</th><th>Clause / note</th><th>From</th><th /></tr></thead><tbody>
        {fixed.map((r) => (
          <tr key={`f-${r.id}`} className="m">
            <td>{kindLabel(r.kind)}</td><td colSpan={3}>{appliesText(r)}</td>
            <td className="num">{r.value} {unitOf(r.kind)}</td>
            <td>{[r.clause, r.note].filter(Boolean).join(' — ')}</td>
            <td>{r.from}</td><td />
          </tr>
        ))}
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <select value={r.kind} disabled={readOnly} aria-label="Rule" onChange={(e) => set(r.id, { kind: e.target.value as RuleKind })}>
                {RULE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            </td>
            <td>
              <select value={r.when?.category ?? ''} disabled={readOnly} aria-label="Circuits" onChange={(e) => setWhen(r, { category: (e.target.value || undefined) as RuleCategory | undefined })}>
                {CATEGORY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </td>
            <td>
              <select value={r.when?.loadType ?? ''} disabled={readOnly} aria-label="Load type" onChange={(e) => setWhen(r, { loadType: (e.target.value || undefined) as LoadType | undefined })}>
                <option value="">Any</option>
                {LOAD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </td>
            <td className="num">
              <input type="number" min={0} step={0.5} style={{ width: 64 }} aria-label="From kW" disabled={readOnly} value={r.when?.minKw ?? ''} placeholder="—"
                onChange={(e) => setWhen(r, { minKw: e.target.value === '' ? undefined : +e.target.value })} />
            </td>
            <td className="num">
              <input type="number" style={{ width: 64 }} aria-label="Value" disabled={readOnly} value={Number.isFinite(r.value) ? r.value : ''}
                onChange={(e) => set(r.id, { value: e.target.value === '' ? NaN : +e.target.value })} /> {unitOf(r.kind)}
            </td>
            <td><input value={r.clause ?? ''} aria-label="Clause / note" disabled={readOnly} style={{ width: 150 }} onChange={(e) => set(r.id, { clause: e.target.value || undefined })} /></td>
            <td className="m">{r.from ?? 'Here'}</td>
            <td>{!readOnly && <button type="button" className="icon-btn" title="Remove" aria-label="Remove" onClick={() => onChange?.(rows.filter((x) => x.id !== r.id))}><X size={14} aria-hidden /></button>}</td>
          </tr>
        ))}
        {!rows.length && !fixed.length && <tr><td colSpan={8} className="m">{empty}</td></tr>}
      </tbody></table>
    </div>
  );
}
