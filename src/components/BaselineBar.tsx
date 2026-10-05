import { useDeferredValue, useMemo } from 'react';
import type { Project } from '../types';
import { draftSummary } from '../model/designBaseline';
import { CLASS_LABEL } from '../model/changeClass';

/** On the design workspace: which issued revision the working draft is measured against, and how far the draft has moved.
 * Pricing changes are listed apart from engineering, so a contractor's estimate never reads as a design change. */
export default function BaselineBar({ project, onCompare, onImpact }: { project: Project; onCompare: () => void; onImpact?: () => void }) {
  const deferred = useDeferredValue(project); // the comparison never holds up typing
  const s = useMemo(() => draftSummary(deferred), [deferred]);
  if (!s) return null;
  const { revision: r, counts } = s;
  const parts = (['engineering', 'drawing', 'commercial'] as const).filter((c) => counts[c] > 0).map((c) => `${counts[c]} ${CLASS_LABEL[c].split(' (')[0].toLowerCase()}`);
  const contractor = project.brief?.role === 'contractor';
  return (
    <div className="baseline-bar" role="status">
      <span><b>Baseline: Rev {r.id}</b> <span className="m">{r.date}{r.description ? ` · ${r.description}` : ''}{s.chosen ? '' : ' · latest issued'}</span></span>
      <span className={s.designChanged ? 'warn' : 'm'}>
        {deferred !== project ? 'Comparing…' : parts.length ? `Working draft: ${parts.join(' · ')} change${parts.length === 1 && Object.values(counts).reduce((a, b) => a + b, 0) === 1 ? '' : 's'}` : 'Working draft matches the baseline'}
      </span>
      {contractor && counts.engineering > 0 && <span className="warn">Engineering edits differ from the received design — record them as a proposed modification.</span>}
      <span className="sp" />
      {onImpact && <button className="chip" onClick={onImpact} title="What the draft touches: panels, studies to run again, drawings, schedules and BOQ quantities">Impact…</button>}
      <button className="chip" onClick={onCompare} title="List every difference between the baseline and the working draft">Compare with baseline</button>
    </div>
  );
}
