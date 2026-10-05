import type { DxfSheetPage } from './sheetDxf';

export interface DxfFile { name: string; data: string; continuation: boolean; warnings: string[] }

export const namedDxfFiles = (base: string, pages: DxfSheetPage[]): DxfFile[] => pages.map((p, i) => ({
  name: `${base}${i ? `_continuation_${i}` : ''}.dxf`, data: p.data, continuation: p.continuation, warnings: p.warnings
}));

/** A repeated drawing number must not overwrite another sheet in a ZIP. */
export function uniqueDxfFiles(files: DxfFile[]): DxfFile[] {
  const used = new Set<string>();
  return files.map((file) => {
    let name = file.name, n = 2;
    while (used.has(name.toLowerCase())) name = file.name.replace(/\.dxf$/i, `_${n++}.dxf`);
    used.add(name.toLowerCase());
    return { ...file, name };
  });
}

export function dxfExportNotice(files: DxfFile[]): string {
  const count = files.filter((f) => f.continuation).length;
  const warnings = [...new Set(files.flatMap((f) => f.warnings))];
  return [count ? `${count} continuation sheet${count > 1 ? 's' : ''} included` : '', ...warnings].filter(Boolean).join(' — ');
}
