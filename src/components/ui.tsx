import type { ReactNode } from 'react';
import type { Status } from '../calc/electrical';

export const STATUS_LABEL: Record<Status, string> = { ok: 'Pass', warn: 'Check', bad: 'Fail' };

export function StatusCell({ status, children }: { status: Status; children?: ReactNode }) {
  return <td className={status}>{children ?? STATUS_LABEL[status]}</td>;
}

/** Count of pass / check / fail, shown at the top of each study. */
export function StatusCounts({ statuses }: { statuses: Status[] }) {
  const n = (s: Status) => statuses.filter((x) => x === s).length;
  return (
    <span className="counts">
      <span className="ok">{n('ok')} pass</span>
      <span className="warn">{n('warn')} check</span>
      <span className="bad">{n('bad')} fail</span>
    </span>
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
