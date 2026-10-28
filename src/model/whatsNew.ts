/** What each release added, in plain words, for the What's new window shown once after an update (and from Help).
 * Add the new version at the top of RELEASES with each release batch, one line per feature. */

export type WhatsNewAction = 'cad' | 'floor-plan' | 'floor-plan-lengths' | 'floor-plan-trays' | 'floor-plan-boards';

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
    version: '1.92', date: '2026-10-28',
    items: [
      { title: 'CAD: add devices on the plan', text: 'Add device (DEV): lights, sockets, fans, A/C, water heaters on a circuit — counted on that circuit — a DB at its place, or ELV devices (detectors, cameras, data, speakers). Click a device to see it; Move (M) and Delete (E) as in CAD.', action: 'cad', actionLabel: 'Open CAD' },
      { title: 'CAD: save DXF with your devices', text: 'Save DXF writes the architect\'s drawing with the devices you placed on their own layers (E-LV-POINTS, E-ELV-DEVICES, E-BOARDS).' }
    ]
  },
  {
    version: '1.91', date: '2026-10-28',
    items: [
      { title: 'CAD: measure distances', text: 'Distance (DI): click two snapped points for the length, ΔX, ΔY and angle; ORTHO keeps it straight.', action: 'cad', actionLabel: 'Open CAD' },
      { title: 'CAD: areas and room areas', text: 'Area by corners or a closed object (AREA, O), or Room area: click inside a room, its outline comes from the walls. Add as room… puts it in Building information.', action: 'cad', actionLabel: 'Show me' },
      { title: 'CAD: click an object to see what it is', text: 'Its type, layer, handle, block name and attributes, length or area — shown in the Result panel and highlighted on the drawing.' }
    ]
  },
  {
    version: '1.90', date: '2026-10-28',
    items: [
      { title: 'CAD view: open drawings natively', text: 'A new CAD tab opens DWG / DXF the way a CAD program does: model space, crosshair, snaps (endpoint, midpoint, centre, intersection), layers on / off, blocks drawn as drawn, a command line and SNAP · OSNAP · ORTHO · GRID. Measuring and devices come next.', action: 'cad', actionLabel: 'Open CAD' }
    ]
  },
  {
    version: '1.89', date: '2026-10-28',
    items: [
      { title: 'Floor plan in the web version', text: 'The web version opens DWG / DXF plans too: the same reader runs in the browser, plans are chosen with the file picker and never leave your computer. The sample villa is there as well.', action: 'floor-plan', actionLabel: 'Open Floor plan' }
    ]
  },
  {
    version: '1.88', date: '2026-10-28',
    items: [
      { title: 'Sample G+1 villa plan for testing', text: 'The Floor plan page shows a sample villa (ground and first floor) while no plan is open: rooms with and without outlines, doors, boards, lights, cable routes and trays. Open plan replaces it with yours.', action: 'floor-plan', actionLabel: 'Open Floor plan' }
    ]
  },
  {
    version: '1.87', date: '2026-10-28',
    items: [
      { title: 'ELV schedules', text: 'The ELV page lists devices per room and floor, fire alarm loops and zones, switch ports, door controllers and PA zones, and an ELV BOQ. Type remarks on any row; export to Excel or a black-and-white PDF.' },
      { title: 'ELV plan sheets and DXF', text: 'One A3 sheet per level with all ELV systems in your title block; a typical level names its floors (L05–L09). DXF for CAD puts the devices on the architect plan in its own units.' },
      { title: 'ELV in the project BOQ, when you choose', text: 'Add to project BOQ… adds the ELV systems you tick to section P. Nothing is added by default, and the page tells you when the BOQ copy is out of date.' },
      { title: 'Choose the units of a floor plan', text: 'The Floor plan page shows the units the drawing is in and lets you change them; areas, positions and lengths follow. A drawing that does not say asks you first.', action: 'floor-plan', actionLabel: 'Open Floor plan' },
      { title: 'Opens faster', text: 'Pages and dialogs load when you first open them, and the app starts without loading spreadsheet code it does not need yet.' }
    ]
  },
  {
    version: '1.86', date: '2026-10-28',
    items: [
      { title: 'Design ELV on the floor plan', text: 'New ELV group on the Floor plan tab: pick fire alarm, CCTV, access control, data or PA, then place devices with a click or fill a room on a grid. Move, turn and delete them with Select.', action: 'floor-plan', actionLabel: 'Open Floor plan' },
      { title: 'Coverage, loops and quantities as you place', text: 'Detector, Wi-Fi and speaker coverage is checked over each room, with what is not covered shaded. The ELV tab shows devices per room, loops and zones, switch ports and PA amplifiers.', action: 'floor-plan', actionLabel: 'Show me' },
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
