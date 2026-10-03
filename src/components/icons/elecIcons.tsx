/** Small IEC-style ribbon icons drawn like the SLD symbols, sized and
 * stroked like the Lucide icons beside them (24 × 24 grid). */

type P = { size?: number; strokeWidth?: number; className?: string };
const Svg = ({ size = 24, strokeWidth = 2, className, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {children}
  </svg>
);

/** Transformer: two overlapping windings (IEC 60617). */
export const TransformerIcon = (p: P) => (
  <Svg {...p}><circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" /><path d="M1.5 12h2M20.5 12h2" /></Svg>
);

/** Add board: a busbar with outgoing ways and a plus. */
export const AddBoardIcon = (p: P) => (
  <Svg {...p}><path d="M3 9h12M5 9v6M9 9v6M13 9v6M9 4v5" /><path d="M19 13v6M16 16h6" /></Svg>
);

/** Board properties: a panel with a gear. */
export const BoardPropsIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v6" /><path d="M7 7h8M7 11h5" />
    <circle cx="18" cy="17" r="2" /><path d="M18 13.5v1.5M18 19v1.5M21.5 17H20M16 17h-1.5M20.5 14.5l-1 1M16.5 18.5l-1 1M20.5 19.5l-1-1M16.5 15.5l-1-1" />
  </Svg>
);

/** Transformer & generator sizing: transformer, generator and a check. */
export const TxGenSizingIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="5.5" cy="8" r="3.5" /><circle cx="9.5" cy="8" r="3.5" />
    <circle cx="16.5" cy="8" r="4" /><path d="M17.8 6.6a1.9 1.9 0 1 0 .2 2.4h-1.5" />
    <path d="M7 18l2.5 2.5L15 15" />
  </Svg>
);
