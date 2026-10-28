/** What each release added, in plain words, for the What's new window shown once after an update (and from Help).
 * Add the new version at the top of RELEASES with each release batch, one line per feature. */

export type WhatsNewAction = 'floor-plan' | 'floor-plan-lengths' | 'floor-plan-trays' | 'floor-plan-boards';

export interface WhatsNewItem {
  title: string;
  text: string;
  /** What the item's button opens; no button without one. */
  action?: WhatsNewAction;
  actionLabel?: string;
}

export interface Release { version: string; date: string; items: WhatsNewItem[] }

export const RELEASES: Release[] = [
  {
    version: '1.86', date: '2026-10-28',
    items: [
      { title: 'ELV fire alarm loops with 20 % spare', text: 'The ELV estimate now fills each loop to 80 % of 125 devices and checks its current in alarm, so some projects show more loops. Every limit is a project rule.' },
      { title: 'Rooms from the plan keep their shape', text: 'Rooms taken from a floor plan now remember their outline, ready for placing ELV devices on the plan.', action: 'floor-plan', actionLabel: 'Open Floor plan' },
      { title: 'Command line: ELV devices and schedules', text: 'elv-place-devices puts ELV devices on a level; elv-schedules gives the detection zones, loops with addresses, switch ports, door controllers and PA zones.' }
    ]
  },
  {
    version: '1.85', date: '2026-10-28',
    items: [
      { title: 'Floor plan is now a page beside the SLD', text: 'No pop-up window: the plan opens in the page canvas, and every tool is on the new Floor plan ribbon tab.', action: 'floor-plan', actionLabel: 'Open Floor plan' },
      { title: 'Picks go straight into the model', text: 'Click inside a room, trace it or pick its name, link a route or a tray run, place a board — each is added at once (⌘Z undoes it). The panel shows what is in the model.', action: 'floor-plan', actionLabel: 'Show me' },
      { title: 'The plan stays open', text: 'Move between pages and come back; next time the project offers to reopen the same plan.' }
    ]
  },
  {
    version: '1.84', date: '2026-10-28',
    items: [
      { title: 'Floor plan: open DWG / DXF in the app', text: 'No CAD program needed. Floor plan button on the Home and 1 Concept tabs; or in Finder right-click a drawing → Open with → LV Design Studio.', action: 'floor-plan', actionLabel: 'Open Floor plan' },
      { title: 'Rooms and areas from the plan', text: 'Found automatically, or click inside a room and click its name. They go to Building information, and the Load assessment follows.', action: 'floor-plan', actionLabel: 'Show me' },
      { title: 'Cable lengths from the plan', text: 'Routes on the cable route layers link themselves; choose a feeder and click its lines for the rest. Review and apply.', action: 'floor-plan-lengths', actionLabel: 'Show me' },
      { title: 'Tray routes and board locations', text: 'Name tray runs and place boards by clicking them on the plan; trays per feeder, tray lengths and board rooms are reviewed and applied.', action: 'floor-plan-trays', actionLabel: 'Show me' },
      { title: 'Command line: cad-plan and rooms-from-cad', text: 'Read a floor plan and take its rooms into a project without opening the app.' }
    ]
  }
];

/** "1.84" < "1.9"? Compared part by part as numbers. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The releases to show on this computer: those after the version last seen, up to the running one. When none was seen
 * yet, the running version's own items for an app used before (an update), and nothing for a new install. */
export function unseenReleases(lastSeen: string | undefined, current: string, usedBefore: boolean, releases: Release[] = RELEASES): Release[] {
  const upTo = releases.filter((r) => compareVersions(r.version, current) <= 0);
  if (!lastSeen) return usedBefore ? upTo.filter((r) => r.version === current) : [];
  return upTo.filter((r) => compareVersions(r.version, lastSeen) > 0);
}

const SEEN_KEY = 'lvds.whatsNewSeen';

/** The releases this computer has not seen yet (localStorage; an app with other saved settings was used before). */
export function pendingReleases(current: string): Release[] {
  try {
    const seen = localStorage.getItem(SEEN_KEY) ?? undefined;
    const usedBefore = Object.keys(localStorage).some((k) => k.startsWith('lvds.') && k !== SEEN_KEY);
    const out = unseenReleases(seen, current, usedBefore);
    if (!seen && !out.length) localStorage.setItem(SEEN_KEY, current); // a new install starts as seen
    return out;
  } catch {
    return [];
  }
}

export function markSeen(current: string): void {
  try { localStorage.setItem(SEEN_KEY, current); } catch { /* storage refused: shown again next time */ }
}
