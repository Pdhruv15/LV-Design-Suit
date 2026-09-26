import type { LoadType } from '../types';

/** Small line-art glyph for a load type, drawn centred on (0,0) inside a
 * ~34 px circle. Uses currentColor so the caller controls the colour. */
export default function LoadIcon({ type }: { type: LoadType }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const text = (t: string, size = 11) => (
    <text x="0" y={size * 0.36} textAnchor="middle" style={{ fill: 'currentColor', font: `600 ${size}px system-ui, sans-serif` }}>
      {t}
    </text>
  );
  switch (type) {
    case 'lighting':
      return (
        <g {...s}>
          <path d="M-5 3 a7 7 0 1 1 10 0 q-1.5 1.5 -1.5 3.5 h-7 q0 -2 -1.5 -3.5 z" />
          <line x1="-3" y1="9" x2="3" y2="9" />
        </g>
      );
    case 'sockets':
      return (
        <g {...s}>
          <circle r="9" />
          <line x1="-3.5" y1="-4" x2="-3.5" y2="0" />
          <line x1="3.5" y1="-4" x2="3.5" y2="0" />
          <line x1="0" y1="3.5" x2="0" y2="5" />
        </g>
      );
    case 'hvac':
      return (
        <g {...s}>
          {[0, 60, 120].map((a) => (
            <line key={a} x1="0" y1="-9" x2="0" y2="9" transform={`rotate(${a})`} />
          ))}
          <circle r="2" />
        </g>
      );
    case 'motor':
      return text('M', 13);
    case 'fire-pump':
      return text('FP', 11);
    case 'ev':
      return text('EV', 11);
    case 'it':
      return (
        <g {...s}>
          <rect x="-8" y="-7" width="16" height="11" rx="1.5" />
          <line x1="-4" y1="8" x2="4" y2="8" />
          <line x1="0" y1="4" x2="0" y2="8" />
        </g>
      );
    case 'pv':
      return (
        <g {...s}>
          <path d="M-9 5 L-6 -6 H6 L9 5 Z" />
          <line x1="-7.5" y1="0" x2="7.5" y2="0" />
          <line x1="0" y1="-6" x2="0" y2="5" />
        </g>
      );
    default:
      // IEC-style load symbol: arrow pointing into the load.
      return (
        <g {...s}>
          <line x1="0" y1="-9" x2="0" y2="4" />
          <path d="M-5 0 L0 8 L5 0 Z" style={{ fill: 'currentColor' }} />
        </g>
      );
  }
}
