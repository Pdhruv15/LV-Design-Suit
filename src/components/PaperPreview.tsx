import { useLayoutEffect, useRef, useState } from 'react';

const SHEETS: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841] };
const PX_PER_MM = 96 / 25.4;

export interface PaperPage { size: string; landscape: boolean; wMm: number; hMm: number; margin: [number, number, number, number] }

/** The page a report prints on, read from its own unnamed @page rule (the last one wins, as in print), so the
 * preview always shows the paper and margins the PDF uses. Falls back to A4 portrait with 12 mm margins. */
export function pageOf(html: string): PaperPage {
  let size = 'A4', landscape = false, margin: [number, number, number, number] = [12, 12, 12, 12];
  for (const m of html.matchAll(/@page\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const s = /size:\s*(A\d)\s*(landscape|portrait)?/i.exec(body);
    if (s) { size = s[1].toUpperCase(); landscape = (s[2] ?? '').toLowerCase() === 'landscape'; }
    const mg = /margin:\s*([^;]+)/i.exec(body);
    if (mg) {
      const v = mg[1].trim().split(/\s+/).map((x) => parseFloat(x));
      if (v.every((n) => Number.isFinite(n))) {
        const [t, r = t, b = t, l = r] = v;
        margin = [t, r, b, l];
      }
    }
  }
  const [w, h] = SHEETS[size] ?? SHEETS.A4;
  return { size, landscape, wMm: landscape ? h : w, hMm: landscape ? w : h, margin };
}

/** The report on a sheet of its own paper size, scaled to fit, with dashed margin guides. The preview copy of
 * the HTML gets the page margins as screen padding; what is exported is not changed. */
export function PaperPreview({ html, title }: { html: string; title: string }) {
  const page = pageOf(html);
  const [t, r, b, l] = page.margin;
  const desk = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, h: 600 });
  const wPx = page.wMm * PX_PER_MM;
  useLayoutEffect(() => {
    const el = desk.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setFit({ scale: Math.min(1, Math.max(0.2, (el.clientWidth - 32) / wPx)), h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wPx]);
  const screenCss = `<style>@media screen{html{background:#fff}body{margin:0!important;padding:${t}mm ${r}mm ${b}mm ${l}mm!important;box-sizing:border-box}}</style>`;
  const doc = html.includes('</head>') ? html.replace('</head>', `${screenCss}</head>`) : screenCss + html;
  const label = `${page.size} ${page.landscape ? 'landscape' : 'portrait'} · margins ${t} / ${r} / ${b} / ${l} mm`;
  return (
    <figure className="paper-preview">
      <figcaption className="m">{label} <span>· dashed lines = page margins</span></figcaption>
      <div className="paper-desk" ref={desk}>
        <div className="paper-sheet" style={{ width: wPx, height: (fit.h - 32) / fit.scale, transform: `scale(${fit.scale})` }}>
          <iframe title={title} sandbox="" srcDoc={doc} />
          <div className="paper-guides" aria-hidden style={{ top: `${t}mm`, right: `${r}mm`, left: `${l}mm`, bottom: 0 }} />
        </div>
      </div>
    </figure>
  );
}
