import { useMemo, useState } from 'react';
import type { Project, ProjectParams } from '../../types';
import { boardParamNames, fillParams, paramList, type ParamDef } from '../../model/params';
import { Page } from '../ui';

/** Home → Parameters: every {Name} you can use in title blocks, SLD notes
 * and component labels — the project's own, people and dates, your own. */
export default function ParametersView({ project, onChange, onStatus, onTitleBlock }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void; onTitleBlock: () => void }) {
  const list = useMemo(() => paramList(project), [project]);
  const pp = project.params ?? {};
  const setP = (patch: Partial<ProjectParams>) => onChange({ ...project, params: { ...pp, ...patch } });
  const custom = pp.custom ?? [];
  const [test, setTest] = useState('Designed {DesignedBy} · Checked {CheckedBy} · {SMDB-GF.DemandKW} kW on SMDB-GF');
  const notes = project.drawing?.notes ?? [];
  const setNotes = (n: string[]) => onChange({ ...project, drawing: { ...project.drawing, notes: n.length ? n : undefined } });
  const copy = (name: string) => { try { navigator.clipboard?.writeText(`{${name}}`); onStatus(`Copied {${name}} — paste it into a title block, note or label`); } catch { onStatus(`{${name}}`); } };

  const row = (x: ParamDef) => (
    <tr key={x.name}>
      <td><button className="param-chip" title="Copy" onClick={() => copy(x.name)}>{`{${x.name}}`}</button></td>
      <td>
        {x.editable && x.editable !== 'custom' ? (
          <input className="bi-text" style={{ width: 260 }} defaultValue={x.value} key={x.value} placeholder={x.hint}
            onBlur={(e) => e.target.value !== x.value && setP({ [x.editable as keyof ProjectParams]: e.target.value || undefined })} />
        ) : x.editable === 'custom' ? (
          <input className="bi-text" style={{ width: 260 }} defaultValue={x.value} key={x.value}
            onBlur={(e) => setP({ custom: custom.map((c) => (c.name === x.name ? { ...c, value: e.target.value } : c)) })} />
        ) : <span>{x.value || <span className="m">— (set in Project settings / Building)</span>}</span>}
      </td>
      <td>{x.editable === 'custom' && <button className="icon-btn" title="Remove" onClick={() => setP({ custom: custom.filter((c) => c.name !== x.name) })}>✕</button>}</td>
    </tr>
  );
  const groups: ParamDef['group'][] = ['People & dates', 'Your own', 'Project', 'Design'];

  return (
    <Page
      title="Parameters"
      intro="Named values you write as {Name} in title blocks, SLD notes and component labels — change one here and every sheet updates. Click a name to copy it."
      actions={<button className="chip" onClick={onTitleBlock}>Title block designer</button>}
    >
      <div className="param-grid">
        <div>
          {groups.map((g) => (
            <section key={g} className="card" style={{ marginBottom: 12 }}>
              <h4 style={{ margin: '0 0 8px' }}>{g}</h4>
              <table className="param-table"><tbody>
                {list.filter((x) => x.group === g).map(row)}
                {g === 'Your own' && !custom.length && <tr><td colSpan={3} className="m">Add values like a contract no., phase or MEP contractor.</td></tr>}
              </tbody></table>
              {g === 'Your own' && (
                <button className="chip" onClick={() => {
                  const name = `Param${custom.length + 1}`;
                  setP({ custom: [...custom, { name, value: '' }] });
                  onStatus('Rename it below: letters and numbers, no spaces');
                }}>+ Parameter</button>
              )}
              {g === 'Your own' && custom.length > 0 && (
                <div className="m" style={{ marginTop: 6 }}>Rename: {custom.map((c) => (
                  <input key={c.name} className="bi-text" style={{ width: 120, marginRight: 6 }} defaultValue={c.name}
                    onBlur={(e) => { const n = e.target.value.replace(/[^A-Za-z0-9_]/g, ''); if (n && n !== c.name && !list.some((x) => x.name === n)) setP({ custom: custom.map((x) => (x.name === c.name ? { ...x, name: n } : x)) }); }} />
                ))}</div>
              )}
            </section>
          ))}
          <section className="card">
            <h4 style={{ margin: '0 0 8px' }}>Board values</h4>
            <p className="m">Any board: <code>{'{BOARD-ID.Property}'}</code> — e.g. <code>{'{SMDB-GF.DemandKW}'}</code>. Properties: {boardParamNames.join(', ')}.</p>
          </section>
        </div>
        <div>
          <section className="card" style={{ marginBottom: 12 }}>
            <h4 style={{ margin: '0 0 8px' }}>Try it</h4>
            <textarea className="param-try" value={test} onChange={(e) => setTest(e.target.value)} />
            <p className="param-out">{fillParams(test, project)}</p>
          </section>
          <section className="card">
            <h4 style={{ margin: '0 0 8px' }}>Notes on the SLD sheet</h4>
            <p className="m">Printed above the title block of the exported drawing (PDF). One note per line; {'{Parameters}'} are filled in.</p>
            <textarea className="param-try" style={{ minHeight: 120 }} defaultValue={notes.join('\n')} key={notes.join('\n')}
              placeholder={'1. All cables Cu/XLPE/SWA/PVC unless noted.\n2. Maximum demand {MaxDemand} on {TransformerKVA} transformer.'}
              onBlur={(e) => setNotes(e.target.value.split('\n').map((l) => l.trimEnd()).filter(Boolean))} />
            {notes.length > 0 && <ol className="param-notes">{notes.map((n, i) => <li key={i}>{fillParams(n, project)}</li>)}</ol>}
          </section>
        </div>
      </div>
    </Page>
  );
}
