/** What each release added, in plain words, for the What's new window shown once after an update (and from Help).
 * Add the new version at the top of RELEASES with each release batch, one line per feature. */

export type WhatsNewAction = 'cad' | 'sheets' | 'floor-plan' | 'floor-plan-lengths' | 'floor-plan-trays' | 'floor-plan-boards';

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
    version: '2.9', date: '2026-10-30',
    items: [
      { title: 'Title block at its standard size', text: 'Sheets keep the title block 180 mm wide with 2.5 mm text on A3, A2 and A1, instead of growing with the paper and the drawing (it reached almost half the width of an A1 sheet). A4 shrinks it only as far as it must. The revision table, notes and cable schedule follow, so more fits on each sheet.', action: 'sheets', actionLabel: 'Open Sheets' }
    ]
  },
  {
    version: '2.8', date: '2026-10-30',
    items: [
      { title: 'Cable trays as a single line', text: 'Design CAD → Plan: a cable tray run is now one line with its label in the line, like "CT 300 POWER" (and its route once assigned), the way design-stage layouts show it. DXF and DWG are written the same way.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'What a tray carries', text: 'Each tray run has Carries beside its width: Power, Lighting, ELV, Data or Fire alarm. New runs start as Power.' }
    ]
  },
  {
    version: '2.7', date: '2026-10-30',
    items: [
      { title: 'Circuit wiring on the plan', text: 'Design CAD → Plan → Wiring: Wire circuits joins every circuit\'s devices on the level with wiring arcs and a home run to its DB, tagged like "DB-GF1/L3 · 2C × 1.5 mm² · 23 m". Wire one does a single circuit (click it again to take it off), and Tags shows or hides the tags.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'Wiring lengths in the cable schedule', text: 'Update schedules gives each wired circuit its length: along the arcs and home run, plus 1.5 m drop per device and 10 % allowance, rounded up. A cable route drawn for the circuit still comes first.' },
      { title: 'Wiring in DXF and DWG', text: 'Save DXF / Save DWG write the wiring on E-LV-WIRING and the tags on E-LV-TAGS.' }
    ]
  },
  {
    version: '2.6', date: '2026-10-29',
    items: [
      { title: 'The same view controls everywhere', text: 'The SLD, Design CAD and Sheets zoom, pan and fit the same way: the wheel or a pinch zooms at the cursor, two fingers on a trackpad pan, press the wheel (or hold Space) and drag to pan, double-click the wheel or press F to fit, + and − zoom, arrow keys pan.' },
      { title: 'Zoom in the corner', text: 'Every drawing shows its zoom in the bottom-right corner (100 % = all in view); click it to fit.' },
      { title: 'Grid dots in Design CAD', text: 'GRID (F7) steps lines → dots → off, as G does on the SLD.', action: 'cad', actionLabel: 'Open Design CAD' }
    ]
  },
  {
    version: '2.5', date: '2026-10-29',
    items: [
      { title: 'Sheet tools on the ribbon', text: 'With a sheet open in Design CAD → Sheets, the ribbon has its tools: Markup (Select, Cloud, Note, Callout, Arrow, Box, Line), On panels, Style (colour, text height, Delete), View (Fit, zoom, Legend, Side by side) and Issue and export. The sheet gets the whole page; the keys are the same.', action: 'sheets', actionLabel: 'Open Sheets' },
      { title: 'Black markups', text: 'New clouds, notes and callouts are black, like the printed sheets; red and blue are still in Style → Colour.' },
      { title: 'One sheet as DWG', text: 'Issue and export → DWG (or right-click a sheet) saves that sheet as AutoCAD 2018 DWG.' }
    ]
  },
  {
    version: '2.4', date: '2026-10-29',
    items: [
      { title: 'Sheets in Design CAD', text: 'Every submission sheet is in Design CAD → Sheets: SLDs, risers, the earthing schematic, earth riser and floor earthing, with the register (layout, title block and numbering, issues, export). The SLD and earthing screens keep the design; their Sheets button opens the sheet.', action: 'sheets', actionLabel: 'Open Sheets' },
      { title: 'Clouds and notes on earthing sheets', text: 'The earthing schematic, earth riser and floor earthing sheets get the Markup tools too: revision clouds, notes, callouts, arrows, boxes and lines, printed on the PDF and DXF.' },
      { title: 'New sheet from any panel', text: 'Panel and its branch asks which panel when none is picked; Side by side shows the design with each sheet\'s panels outlined, to move a panel to another sheet.' }
    ]
  },
  {
    version: '2.3', date: '2026-10-29',
    items: [
      { title: 'One drawing background', text: 'Design CAD now draws on the same background and grid as the SLD, riser, earthing and lux plans, in the dark and light themes. Switching theme redraws the CAD plan straight away.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'DWG colours you can read', text: 'Layer colours too faint on the background are shown lighter or darker with the same hue: yellow shows as gold on the light theme, blue lighter on the dark one. Saved DWG, DXF and PDF keep the original colours.' },
      { title: 'Black revision clouds on the PDF', text: 'Revision clouds and cable reference circles print black, like the rest of the drawing; riser busbar trunking prints black and shows in the busbar colour on screen.' },
      { title: 'SLD as DWG', text: 'Export SLD drawing → DWG saves the SLD sheets as AutoCAD 2018 DWG, with the same layers and title block as the DXF; continuation sheets come in a ZIP. Made by the Design CAD engine.' }
    ]
  },
  {
    version: '2.2', date: '2026-10-29',
    items: [
      { title: 'Design CAD: Save DWG', text: 'File → Save DWG (SAVEDWG) saves the plan as a DWG — in the version it came in, else AutoCAD 2018 — with what you drew, the trays and routes, and the devices placed, as a new file. The architect\'s drawing is not changed. Open it once in your CAD program to check before you send it.', action: 'cad', actionLabel: 'Open Design CAD' }
    ]
  },
  {
    version: '2.1', date: '2026-10-29',
    items: [
      { title: 'Design CAD: linetypes', text: 'Dashed, centre, hidden and other linetypes are drawn as in the drawing (with its LTSCALE and each object\'s scale); too fine to see at the zoom, they show continuous, as in CAD.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'Hatches', text: 'Solid hatches and 2D solids are filled; pattern hatches (ANSI31, brick…) show their pattern lines inside the boundary, or a light fill when zoomed out.' },
      { title: 'Faster on big drawings', text: 'The drawing is kept in tiles and only what is on screen is drawn while you pan and zoom.' }
    ]
  },
  {
    version: '2.0', date: '2026-10-29',
    items: [
      { title: 'Loads from CAD reads Design CAD', text: 'Loads from CAD floor plan now counts the fixture blocks (with their CCT circuit) on the drawing open in Design CAD — no other CAD program needed.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'OpenCADStudio link removed', text: 'Everything it did is built in: open, measure, rooms, devices, trays, routes and lengths in Design CAD. The SLD still exports as DXF for any CAD program.' }
    ]
  },
  {
    version: '1.99', date: '2026-10-29',
    items: [
      { title: 'One place for plans: Design CAD', text: 'Floor plan and CAD are now one page, Design CAD. Its ribbon has two sub-tabs over the same drawing: Plan (File, Rooms, Cables and boards, Devices, Measure) and Draw (Draw, Modify, Annotate). The Floor plan tab is gone; everything it did is in Design CAD.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'Open with LV Design Studio', text: 'A DWG / DXF opened from Finder or Explorer now opens in Design CAD.' },
      { title: 'Turn cameras and speakers', text: 'Rotate (RO) on a camera or speaker: click where it faces, or type the angle; its coverage turns with it.' }
    ]
  },
  {
    version: '1.98', date: '2026-10-29',
    items: [
      { title: 'Design CAD: Fill room', text: 'Devices → Fill room (FILL): choose an ELV device (detector, speaker, data outlet…), point at a room to see them at their coverage spacing, click to place them all.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'Coverage', text: 'Devices → Coverage (COV): what the chosen device\'s system covers, cut at each room, and the squares not covered; the panel says how many rooms are not fully covered.' },
      { title: 'Copy to level', text: 'Devices → Copy to level: this level\'s devices of that system to another level, at the same positions.' }
    ]
  },
  {
    version: '1.97', date: '2026-10-29',
    items: [
      { title: 'Design CAD: cable routes', text: 'Cables and boards → Cable route (CR): choose the cable, click its route. Or Link route (LR): click a line already on the drawing (a cable layer). Routes are dashed, with the cable\'s name along them.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'Update schedules', text: 'One click (SCHED) takes every level\'s plan into the schedules: each tray route\'s length and fittings (bends, tees, reducers) for the tray schedule and BOQ, each cable\'s length (route + vertical + terminations + waste), and the tray routes it runs along. One undo step.' },
      { title: 'Place board', text: 'Place board is now in Cables and boards too: its room, level and position on the plan.' }
    ]
  },
  {
    version: '1.96', date: '2026-10-29',
    items: [
      { title: 'Design CAD: draw cable trays', text: 'Cables → Cable tray (CT): click the run\'s points, Enter to finish. It is drawn at its width (50–900 mm) with both edges and a "CT 300" label. The tray route is optional: leave it Not assigned and choose it later from the tray\'s panel.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'Tray runs like any drawn object', text: 'Click a run to see its length; change its width or route; Move, Copy, Rotate and Erase it. Save DXF writes it on E-TRAY.' },
      { title: 'Tray fittings found as you draw', text: 'Bends where a run turns, a tee where a run ends on another tray (300 × 150 for a narrower branch), a cross where four meet, a reducer where widths change in line. Shown on the plan, counted in the tray panel, written into the DXF.' }
    ]
  },
  {
    version: '1.95', date: '2026-10-29',
    items: [
      { title: 'Design CAD: rooms', text: 'A new Rooms group. Add found (ROOMS) adds every room the plan outlines, named by the text inside, to Building information on the plan\'s level; adding again updates them. Click inside (RA) and Trace (TR) open the room form straight away, and the room keeps its outline.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'Pick name', text: 'Pick name (PN): click the room name on the drawing. It names the room you just found, or renames the room the text is in.' },
      { title: 'Layer roles guess room outlines', text: 'Layers holding closed outlines or hatches with ROOM / AREA / SPACE in the name are now guessed as Room outline.' }
    ]
  },
  {
    version: '1.94', date: '2026-10-29',
    items: [
      { title: 'Design CAD', text: 'The CAD tab is now Design CAD, right after Project.', action: 'cad', actionLabel: 'Open Design CAD' },
      { title: 'Plans of each level', text: 'File → Plans: the drawing of each level of the project. Open one, open a drawing for a level without one, or replace a level\'s plan with the next revision — what you drew moves to it, devices stay.' },
      { title: 'Level, units and layer roles', text: 'File → Level says which level the drawing is (rooms and devices go to it); Units sets mm / m when the drawing does not say; Layer roles marks walls, room outlines and names, trays — Room area uses the walls.' }
    ]
  },
  {
    version: '1.93', date: '2026-10-28',
    items: [
      { title: 'CAD: draw', text: 'Line (L), Polyline (PL), Rectangle (REC), Circle (C), Arc (A) — with snaps, ORTHO, and typed input: a length, x,y, @dx,dy or @length<angle.', action: 'cad', actionLabel: 'Open CAD' },
      { title: 'CAD: modify', text: 'Move (M), Copy (CO), Rotate (RO) and Erase (E) for what you drew and the devices you placed; a copied light or socket counts on its circuit. The architect\'s drawing stays as received.' },
      { title: 'CAD: annotate', text: 'Text (T) and Dimension (DIM, in metres); all saved into the DXF on LV-SKETCH / LV-ANNO.' },
      { title: 'CAD: grid as lines', text: 'GRID (F7) now draws lines, with a stronger line every fifth.' }
    ]
  },
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
