/** Libraries that don't fit a table — title blocks, components, feeder
 * presets, SLD notes, price lists saved from the BOQ — are kept in
 * LV Database/Library.json beside the workbooks, so they sync through Google
 * Drive to every computer. This computer keeps a working copy. */

export const LIBRARY_KEYS = ['lvds.titleTemplates', 'lvds.components', 'lvds.feederPresets', 'lvds.sldNotes', 'lvds.priceLists', 'lvds.sheetTemplates'] as const;

const bridge = () => (typeof window !== 'undefined' ? window.lvds?.database : undefined);

/** Reads Library.json into this computer's copy (the file wins); first run
 * on a computer: what's here is written to the file. */
export async function pullLibrary(): Promise<number> {
  const db = bridge();
  if (!db?.readLibrary) return 0;
  const data = (await db.readLibrary()) as Record<string, unknown>;
  let n = 0;
  for (const k of LIBRARY_KEYS) {
    if (data[k] === undefined) continue;
    try { localStorage.setItem(k, JSON.stringify(data[k])); n++; } catch { /* storage blocked */ }
  }
  if (!Object.keys(data).length) await pushLibrary();
  return n;
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Writes this computer's libraries to Library.json (debounced). */
export function pushLibrary(): Promise<void> {
  const db = bridge();
  if (!db?.writeLibrary) return Promise.resolve();
  clearTimeout(timer);
  return new Promise((resolve) => {
    timer = setTimeout(async () => {
      const data: Record<string, unknown> = {};
      for (const k of LIBRARY_KEYS) {
        try { const v = localStorage.getItem(k); if (v !== null) data[k] = JSON.parse(v); } catch { /* skip */ }
      }
      try { await db.writeLibrary(data); } catch { /* folder not available */ }
      resolve();
    }, 400);
  });
}
