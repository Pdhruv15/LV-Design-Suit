import { useEffect, useRef, useState } from 'react';

/** A toolbar button that opens a small panel (menu items, ticks, selects).
 * Closes on a click outside or Escape. */
export default function MenuButton({ label, title, active, children, align = 'left' }: { label: React.ReactNode; title?: string; active?: boolean; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="menu-btn" ref={ref}>
      <button className={`chip${active ? ' on' : ''}`} title={title} aria-expanded={open} onClick={() => setOpen(!open)}>{label} ▾</button>
      {open && <div className={`menu-pop ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
