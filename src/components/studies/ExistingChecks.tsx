import { useMemo } from 'react';
import type { Project } from '../../types';
import { evaluateProject } from '../../calc/electrical';
import { existingChecks } from '../../calc/existing';
import { STATUS_LABEL, StatusCell, StatusCounts } from '../ui';

/** Extension of an existing installation: does what is there still carry its recorded
 * demand plus the new load? Shown only when a board is marked existing. */
export function ExistingChecksCard({ project }: { project: Project }) {
  const checks = useMemo(() => (project.boards.some((b) => b.existing) ? existingChecks(project, evaluateProject(project)) : []), [project]);
  if (!project.boards.some((b) => b.existing)) return null;
  return (
    <section className="card txg-card">
      <div className="txg-head">
        <h4>Existing installation</h4>
        <StatusCounts statuses={checks.map((c) => c.status)} />
      </div>
      <p className="m">
        Each existing board’s recorded maximum demand covers its existing load and everything existing below it; the new load is added on top.
        Existing boards, transformers and feeders are drawn dashed, tagged EXISTING and left out of the BOQ.
      </p>
      {checks.length ? (
        <table className="compact">
          <thead><tr><th>Check</th><th>Existing + new</th><th>Limit</th><th>Result</th><th>Status</th></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={`${c.kind}:${c.id}`}>
                <td>{c.item}</td><td>{c.value}</td><td>{c.limit}</td><td>{c.result}</td>
                <StatusCell status={c.status}>{STATUS_LABEL[c.status]}</StatusCell>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="m">Enter the recorded maximum demand on the existing boards (board properties → Existing) to check them.</p>}
    </section>
  );
}
