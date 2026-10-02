import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { drawable, sheetRev, statusColor, type DrawingSet, type DrawingSheet, type SheetSize } from '../../model/drawingSet';
import { SHEET_MM } from '../../docs/sldSheet';
import { sheetHtml } from './sheetRender';

type Thumb = { html: string; size: SheetSize };
const THUMB_W = 230;

/** The sheets as a grid of thumbnails with a status badge. Drag a card to
 * reorder (automatic numbers follow); click to open the full preview;
 * tick to select for bulk changes. Thumbnails are drawn one at a time. */
export default function SheetGrid({ project, set, sheets, run, selected, canDrag, onToggle, onMove, onPreview, onEdit }: {
  project: Project;
  set: DrawingSet;
  sheets: DrawingSheet[];
  run?: CalcRun;
  selected: Set<string>;
  canDrag: boolean;
  onToggle: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onPreview: (s: DrawingSheet, t: Thumb) => void;
  onEdit?: (s: DrawingSheet) => void;
}) {
  const [thumbs, setThumbs] = useState<Record<string, Thumb>>({});
  const [stamp, setStamp] = useState(0); // bump to redraw all
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const live = useRef(project);
  live.current = project;
  const projectRev = project.revisions?.[project.revisions.length - 1]?.id;

  // Draw missing thumbnails one by one (the drawing is rendered off-screen).
  useEffect(() => {
    let stop = false;
    (async () => {
      for (const s of sheets) {
        if (stop) return;
        if (thumbs[s.id] || !drawable(s)) continue;
        const r = await sheetHtml(live.current, set, s, run).catch(() => undefined);
        if (stop) return;
        if (r) setThumbs((t) => ({ ...t, [s.id]: { html: r.html, size: r.size } }));
      }
    })();
    return () => { stop = true; };
  }, [sheets.map((s) => s.id).join(','), stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const index = (id: string) => set.sheets.findIndex((s) => s.id === id);

  return (
    <div>
      <div className="sg-bar">
        <span className="m">{canDrag ? 'Drag a sheet to change the order — automatic numbers follow.' : 'Clear the filters and sort to drag sheets into a new order.'}</span>
        <span className="sp" />
        <button className="chip" onClick={() => { setThumbs({}); setStamp(stamp + 1); }}>Redraw thumbnails</button>
      </div>
      <div className="sg-grid">
        {sheets.map((s) => {
          const t = thumbs[s.id];
          const status = s.status || set.status || '';
          const mm = SHEET_MM[t?.size ?? 'A3'];
          const scale = THUMB_W / (mm.w * 3.78);
          return (
            <div key={s.id}
              className={`sg-card${selected.has(s.id) ? ' on' : ''}${over === s.id && drag && drag !== s.id ? ' over' : ''}${drag === s.id ? ' dragging' : ''}`}
              draggable={canDrag}
              onDragStart={(e) => { setDrag(s.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); }}
              onDragOver={(e) => { if (!drag) return; e.preventDefault(); setOver(s.id); }}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (drag && drag !== s.id) onMove(index(drag), index(s.id)); setDrag(null); setOver(null); }}
              onDragEnd={() => { setDrag(null); setOver(null); }}
            >
              <div className="sg-thumb" style={{ height: mm.h * 3.78 * scale }} onClick={() => t && onPreview(s, t)} title={t ? 'Open the preview' : ''}>
                {t
                  ? <iframe title={s.number} srcDoc={t.html} sandbox="" tabIndex={-1} style={{ width: mm.w * 3.78, height: mm.h * 3.78, transform: `scale(${scale})` }} />
                  : <span className="m">{drawable(s) ? 'Drawing…' : 'No panels'}</span>}
                <span className="sg-badge" style={{ background: statusColor(status) }}>{status || 'NO STATUS'}</span>
                {t && <span className="sg-size">{t.size}</span>}
              </div>
              <div className="sg-meta">
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => onToggle(s.id)} aria-label={`Select ${s.number}`} />
                <span style={{ flex: 1 }}><b>{s.number}</b>  <span className="m">Rev {sheetRev(s, projectRev) || '—'}</span><br />{s.title}</span>
                {onEdit && <button className="chip" onClick={() => onEdit(s)}>Edit</button>}
              </div>
            </div>
          );
        })}
        {!sheets.length && <p className="m">No sheets match.</p>}
      </div>
    </div>
  );
}
