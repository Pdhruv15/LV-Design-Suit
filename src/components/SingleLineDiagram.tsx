import { incomerDeviceOf, type Board, type Project } from '../types';
import { SwitchSym, switchKindOf, type SwitchKind } from '../diagram/IecSymbols';
import type { FeederResult } from '../calc/electrical';
import { circuitRef } from '../calc/loadSchedule';
import { runsOf } from '../calc/electrical';
import { cpcOf } from '../calc/cableTable';
import { cableTypeOf } from '../model/cableTypes';
import { deviceKind, devicePoles } from '../diagram/deviceText';
import { nextPhase, phaseTag } from '../model/phases';

const SPACING = 172; // horizontal slot per feeder
const MARGIN = 80;
const CARD_W = SPACING - 20;
const NAME_CHARS = 24; // per line on a card (12 px text)

/** Words onto at most `lines` lines of `max` characters; text that doesn't fit ends in an ellipsis. */
export function wrapText(text: string, max: number, lines = 2): string[] {
  const all: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const last = all.length - 1;
    if (last >= 0 && `${all[last]} ${w}`.length <= max) all[last] = `${all[last]} ${w}`;
    else all.push(w);
  }
  if (!all.length) return [''];
  const out = all.slice(0, lines);
  const cut = all.length > lines || out.some((l) => l.length > max);
  if (cut) {
    const k = out.length - 1;
    out[k] = `${out[k].slice(0, max - 1).trimEnd()}…`;
  }
  return out.map((l) => (l.length > max && !l.endsWith('…') ? `${l.slice(0, max - 1)}…` : l));
}

export default function SingleLineDiagram({
  board,
  voltageV = 415,
  incomerLabel,
  project,
  results,
  selected,
  onSelect,
  onPhase,
  summary
}: {
  board: Board;
  voltageV?: number;
  incomerLabel?: string;
  /** For each circuit's cable type (insulation, armour) on the cards. */
  project?: Project;
  /** The panel's summary box (LOC, TCL, DF, MDL) — drawn on the single-panel view only, not on the system tree. */
  summary?: { loc: string; tclKw: number; df: number; mdlKw: number };
  results: FeederResult[];
  selected: string | null;
  onSelect: (feederId: string) => void;
  /** Click on a circuit's phase tag: move a single-phase circuit to the next phase. Without it the tag is not shown. */
  onPhase?: (feederId: string) => void;
}) {
  const n = results.length;
  const locLines = summary ? wrapText(`LOC : ${summary.loc || '—'}`, 34, 2) : [];
  const sumH = 18 + (locLines.length + 3) * 12;
  const H = 372;
  const width = Math.max(n, 4) * SPACING + 2 * MARGIN;
  // Never below 85 % scale: a board with many ways scrolls sideways rather than shrinking past reading.
  const minWidth = Math.round(width * 0.85);
  const cx = width / 2; // incomer / transformer position
  const xs = results.map((_, i) => cx + (i - (n - 1) / 2) * SPACING);
  const busX1 = Math.min(cx - 60, (xs[0] ?? cx) - 60);
  const busX2 = Math.max(cx + 60, (xs[n - 1] ?? cx) + 60);
  const isMain = !board.upstreamId;
  const dev = incomerDeviceOf(board);
  const incKind: SwitchKind = dev === 'ISOL' ? 'isolator' : dev === 'ACB' ? 'acb' : dev === 'MCCB-NA' ? 'nonauto' : 'breaker';

  return (
    <svg viewBox={`0 0 ${width} ${H}`} style={{ minWidth, width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`Single line diagram of ${board.name}`}>
      {isMain ? (
        <>
          <line x1={cx} y1="0" x2={cx} y2="17" className="ln" />
          <text className="m" x={cx + 10} y="10">
            11 kV incoming
          </text>
          <circle cx={cx} cy="30" r="13" className="tr" />
          <circle cx={cx} cy="44" r="13" className="tr" />
          <text className="b" x={cx + 22} y="32">
            TX · {board.sourceKva ?? '—'} kVA
          </text>
          <text className="m" x={cx + 22} y="46">
            11/{(voltageV / 1000).toFixed(3)} kV · Z {board.sourceImpedancePct ?? '—'}%
          </text>
          <line x1={cx} y1="57" x2={cx} y2="68" className="ln" />
          {dev ? <SwitchSym x={cx} y={68} kind={incKind} /> : <line x1={cx} y1="68" x2={cx} y2="84" className="ln" />}
          <line x1={cx} y1="84" x2={cx} y2="118" className="ln" />
          {incomerLabel && <text className="m" x={cx + 22} y="79">Incomer {incomerLabel}</text>}
        </>
      ) : (
        <>
          <line x1={cx} y1="10" x2={cx} y2={dev ? 94 : 118} className="ln" />
          <text className="b" x={cx + 22} y="40">
            Incomer
          </text>
          <text className="m" x={cx + 22} y="54">
            {incomerLabel ? `${incomerLabel} · from ${board.upstreamId}` : `from ${board.upstreamId}`}
          </text>
          {dev && <SwitchSym x={cx} y={94} kind={incKind} />}
          {dev && <line x1={cx} y1="110" x2={cx} y2="118" className="ln" />}
        </>
      )}
      {summary && (
        <g className="panel-sum">
          <title>{`${board.id}: TCL ${summary.tclKw.toFixed(2)} kW × DF ${summary.df.toFixed(2)} = MDL ${summary.mdlKw.toFixed(2)} kW`}</title>
          <rect x="8" y="8" width="214" height={sumH} rx="6" className="sum-box" />
          <text x="14" y="21" className="b" style={{ textDecoration: 'underline' }}>{board.id.length > 32 ? `${board.id.slice(0, 31)}…` : board.id}</text>
          {[...locLines, `TCL : ${summary.tclKw.toFixed(2)} kW`, `DF : ${summary.df.toFixed(2)}`, `MDL : ${summary.mdlKw.toFixed(2)} kW`].map((t, i) => (
            <text key={i} x="14" y={35 + i * 12} className="m" xmlSpace="preserve">{i > 0 && i < locLines.length ? `      ${t}` : t}</text>
          ))}
        </g>
      )}
      <text className="b" x={cx - 16} y="106" textAnchor="end" style={{ fill: 'var(--bus)' }}>
        {board.id} · {voltageV} V{board.ratedCurrentA ? ` · ${board.ratedCurrentA} A` : ''} busbar
      </text>
      <line data-dxf-layer="BUSBAR" x1={busX1} y1="118" x2={busX2} y2="118" style={{ stroke: 'var(--bus)', strokeWidth: 4, strokeLinecap: 'round' }} />
      {results.map((r, i) => {
        const x = xs[i];
        const f = r.feeder;
        const col = `var(--${r.status})`;
        const sel = selected === f.id;
        return (
          <g key={f.id} tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onSelect(f.id)} onKeyDown={(e) => e.key === 'Enter' && onSelect(f.id)}>
            <line x1={x} y1="118" x2={x} y2="152" className="ln" />
            <SwitchSym x={x} y={152} kind={switchKindOf(f)} />
            <line x1={x} y1="168" x2={x} y2="236" className="ln" />
            {/* Protective device: rating, poles and kind, then breaking capacity and any RCD */}
            <text className="b" x={x + 11} y="160">{f.breakerRatingA} A {devicePoles(f)} {deviceKind(f)}</text>
            <text className="m" x={x + 11} y="173">{f.breakerIcuKa ? `${f.breakerIcuKa} kA` : ''}{f.rcdMa ? `${f.breakerIcuKa ? ' · ' : ''}${f.rcdMa} mA RCD` : ''}</text>
            {/* Cable: size and length, its type, then the voltage drop */}
            {(() => {
              const t = project ? cableTypeOf(project, f) : undefined;
              // One fact per line, so nothing runs into the next circuit's column.
              const lines = [
                `${runsOf(f) > 1 ? `${runsOf(f)} × ` : ''}${f.cores}C × ${f.cableCsaMm2}mm² · ${f.lengthM} m`,
                ...(t ? [`CU/${t.code}`] : []),
                ...(t?.armoured ? [`+1C ${cpcOf(f)}mm² ECC`] : []),
                `Vd ${r.vdTotalPct.toFixed(1)}% total`
              ];
              return lines.map((l, k) => (
                <text key={k} className="m" x={x + 8} y={190 + k * 12} style={{ fontSize: 10.5 }}>{k === 1 && t ? <title>{t.label}</title> : null}{l}</text>
              ));
            })()}
            {(() => {
              const name = wrapText(f.room || f.name || '—', NAME_CHARS, 2);
              const top = 236, cardH = 68 + (name.length - 1) * 13, bottom = top + cardH;
              return (
                <>
                  <rect x={x - CARD_W / 2} y={top} width={CARD_W} height={cardH} rx="6" className="box" style={sel ? { stroke: 'var(--acc)', strokeWidth: 2 } : undefined} />
                  <title>{`${circuitRef(f) ?? f.id} — ${f.room || f.name || ''}`}</title>
                  <circle cx={x + CARD_W / 2 - 10} cy={top + 12} r="4" fill={col} />
                  <text className="b" x={x - CARD_W / 2 + 8} y={top + 19}>{circuitRef(f) ?? f.id}</text>
                  {onPhase && (() => {
                    const tag = phaseTag(f);
                    const single = tag !== 'RYB';
                    const w = tag === 'RYB' ? 30 : tag ? 22 : 36, right = x + CARD_W / 2 - 18;
                    return (
                      <g className={`ph-tag ${tag ? `ph-${tag.toLowerCase()}` : 'unset'}${single ? ' click' : ''}`}
                        onClick={single ? (e) => { e.stopPropagation(); onPhase(f.id); } : undefined}>
                        <title>{single ? `Phase ${tag || 'not set'} — click to move to ${nextPhase(tag)}` : '3-phase circuit'}</title>
                        <rect x={right - w} y={top + 6} width={w} height={17} rx="4" />
                        <text x={right - w / 2} y={top + 18} textAnchor="middle" className="b">{tag || 'PH ?'}</text>
                      </g>
                    );
                  })()}
                  {name.map((l, k) => <text key={k} className="m" x={x - CARD_W / 2 + 8} y={top + 35 + k * 13}>{l}</text>)}
                  <text x={x - CARD_W / 2 + 8} y={bottom - 12}>
                    {r.ib.toFixed(0)} A{f.feedsBoardId ? ` · → ${f.feedsBoardId}` : ` · ${(f.loadKw * f.demandFactor).toFixed(0)} kW${f.generation ? ' gen' : ''}`}
                  </text>
                  <rect x={x - CARD_W / 2} y={bottom + 8} width={CARD_W} height="6" rx="3" fill="var(--line)" />
                  <rect x={x - CARD_W / 2} y={bottom + 8} width={Math.min(CARD_W, (CARD_W / 100) * r.loadingPct)} height="6" rx="3" fill={col} />
                  <text className="m" x={x - CARD_W / 2} y={bottom + 32}>
                    {r.loadingPct.toFixed(0)}% of {f.breakerRatingA} A
                  </text>
                </>
              );
            })()}
          </g>
        );
      })}
    </svg>
  );
}
