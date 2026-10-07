import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import SystemDiagram from '/src/components/SystemDiagram';
import { printableSvg, svgToDxf } from '/src/diagram/exportSvg';
import { toDxf } from '/src/docs/dxf';
import { buildSheetDxf } from '/src/docs/sheetDxf';
import { dxfExportProject } from '/tests/fixtures/dxfExport';
import '/src/styles.css';
const noop = () => {};
flushSync(() => createRoot(document.querySelector('#root')!).render(<SystemDiagram project={dxfExportProject} results={[]} selectedBoardId={null} selectedFeederId={null} onSelectBoard={noop} onSelectFeeder={noop} hideLegend />));
await new Promise(requestAnimationFrame);
const live = document.querySelector<SVGSVGElement>('.sysdiag svg')!;
const before = live.outerHTML;
const w = Number(live.dataset.w), h = Number(live.dataset.h);
const svg = printableSvg(live, w, h);
const prims = svgToDxf(svg, h);
const checks = [
  ['source diagram unchanged', live.outerHTML === before],
  ['busbar width preserved', prims.some(p => p.layer === 'BUSBAR' && p.width === 4)],
  ['all visible text widths measured', prims.filter(p => p.type === 'text' && p.text.trim()).every(p => p.width > 0)],
  ['RCD oval retained', prims.some(p => p.type === 'polyline' && p.closed && p.points.length >= 16)],
  ['cable labels bounded', prims.filter(p => p.type === 'text' && p.text.includes('CU/')).every(p => p.width <= 113)]
];
document.querySelector('#status')!.textContent = checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'}: ${name}`).join(' · ');
const link = (id, name, data, mime) => {
  const a = document.querySelector<HTMLAnchorElement>(`#${id}`)!;
  document.querySelector<HTMLTextAreaElement>(`#${id}-text`)!.value = data;
  a.href = URL.createObjectURL(new Blob([data], {type: mime})); a.download = name;
};
link('raw', 'DXF-clearance-check.dxf', toDxf(prims), 'application/dxf');
link('sheet', 'DXF-clearance-check-A3.dxf', buildSheetDxf(dxfExportProject, svg, 'A3', {no: 'DXF-001', title: 'CAD EXPORT CLEARANCE CHECK', index:1,count:1}), 'application/dxf');
link('svg', 'DXF-clearance-check.svg', svg, 'image/svg+xml');
