// Writes electron/samples/sample-villa-gf.dxf and sample-villa-ff.dxf: a G+1 villa (16 × 12 m, millimetres, R12 DXF) for
// trying the Floor plan page. The app shows the ground floor by default while no plan is open (a test aid, to be
// removed later — see SAMPLE_PLANS in src/components/floorPlanState.ts).
// Double-line walls (200 mm outside, 100 mm inside) with door openings and door swings, so "Click inside room" finds
// rooms from the walls; room outlines on A-ROOM for some rooms only (the rest are picked); room names as texts and one
// RM-TAG block; boards with TAG attributes matching the sample project (SMDB-GF, DB-GF1, SMDB-FF); lights and sockets with
// CCT circuits; cable routes on E-CABLE and labelled tray runs on E-TRAY.
// Run: node scripts/make-sample-villa-plans.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 16000, H = 12000; // outside wall centrelines
const EXT = 200, INT = 100; // wall thicknesses
const layers = { 'A-WALL': 8, 'A-DOOR': 30, 'A-ROOM': 9, 'A-ROOM-NAME': 7, 'A-STAIR': 8, 'E-BOARD': 1, 'E-LIGHT': 2, 'E-POWER': 3, 'E-CABLE': 6, 'E-TRAY': 4, NOTES: 7 };

function drawing(build) {
  const out = [];
  const g = (code, value) => out.push(String(code), String(typeof value === 'number' ? Math.round(value * 1000) / 1000 : value));
  const line = (layer, x1, y1, x2, y2) => { g(0, 'LINE'); g(8, layer); g(10, x1); g(20, y1); g(30, 0); g(11, x2); g(21, y2); g(31, 0); };
  const arc = (layer, cx, cy, r, a1, a2) => { g(0, 'ARC'); g(8, layer); g(10, cx); g(20, cy); g(30, 0); g(40, r); g(50, a1); g(51, a2); };
  const polyline = (layer, points, closed = false) => {
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    for (const [x, y] of points) { g(0, 'VERTEX'); g(8, layer); g(10, x); g(20, y); g(30, 0); }
    g(0, 'SEQEND'); g(8, layer);
  };
  const rect = (layer, x1, y1, x2, y2) => polyline(layer, [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], true);
  const text = (layer, x, y, height, value) => { g(0, 'TEXT'); g(8, layer); g(10, x); g(20, y); g(30, 0); g(40, height); g(1, value); g(72, 1); g(11, x); g(21, y); g(31, 0); };
  const attdef = (tag, prompt, y) => { g(0, 'ATTDEF'); g(8, '0'); g(10, 250); g(20, y); g(30, 0); g(40, 150); g(1, ''); g(3, prompt); g(2, tag); g(70, 0); };
  const insert = (block, layer, x, y, attributes = {}) => {
    const has = Object.keys(attributes).length;
    g(0, 'INSERT'); g(8, layer); if (has) g(66, 1); g(2, block); g(10, x); g(20, y); g(30, 0);
    if (!has) return;
    for (const [tag, value] of Object.entries(attributes)) { g(0, 'ATTRIB'); g(8, layer); g(10, x + 250); g(20, y); g(30, 0); g(40, 150); g(1, value); g(2, tag); g(70, 0); }
    g(0, 'SEQEND'); g(8, layer);
  };

  /** An axis-aligned wall on its centreline, `t` thick, with door openings [from start, width]: two faces, jambs at
   * each opening and the door leaf with its swing. */
  const wall = (x1, y1, x2, y2, t, openings = []) => {
    const horizontal = y1 === y2;
    const len = horizontal ? x2 - x1 : y2 - y1;
    const at = (s, off) => (horizontal ? [x1 + s, y1 + off] : [x1 + off, y1 + s]);
    const cuts = [...openings].sort((a, b) => a[0] - b[0]);
    let s = 0;
    const pieces = [];
    for (const [from, width] of cuts) { pieces.push([s, from]); s = from + width; }
    pieces.push([s, len]);
    for (const [a, b] of pieces) {
      if (b - a <= 0) continue;
      for (const off of [-t / 2, t / 2]) { const p = at(a, off), q = at(b, off); line('A-WALL', p[0], p[1], q[0], q[1]); }
    }
    for (const [from, width] of cuts) {
      for (const edge of [from, from + width]) { const p = at(edge, -t / 2), q = at(edge, t / 2); line('A-WALL', p[0], p[1], q[0], q[1]); }
      // Door leaf hinged at the opening's start, opening to the + side, with its quarter swing.
      const hinge = at(from, t / 2), leaf = horizontal ? [hinge[0], hinge[1] + width] : [hinge[0] + width, hinge[1]];
      line('A-DOOR', hinge[0], hinge[1], leaf[0], leaf[1]);
      arc('A-DOOR', hinge[0], hinge[1], width, 0, 90);
    }
  };

  // ---- header, tables
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4);
  g(9, '$EXTMIN'); g(10, -1000); g(20, -4000); g(30, 0); g(9, '$EXTMAX'); g(10, W + 1000); g(20, H + 1000); g(30, 0); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1); g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0); g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, Object.keys(layers).length + 1);
  for (const [name, colour] of [['0', 7], ...Object.entries(layers)]) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, colour); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');

  // ---- blocks: light, twin socket, board, room tag
  g(0, 'SECTION'); g(2, 'BLOCKS');
  g(0, 'BLOCK'); g(8, '0'); g(2, 'L1'); g(70, 2); g(10, 0); g(20, 0); g(30, 0); g(3, 'L1');
  g(0, 'CIRCLE'); g(8, '0'); g(10, 0); g(20, 0); g(30, 0); g(40, 200);
  line('0', -140, -140, 140, 140); line('0', -140, 140, 140, -140);
  attdef('CCT', 'Circuit', 0);
  g(0, 'ENDBLK'); g(8, '0');
  g(0, 'BLOCK'); g(8, '0'); g(2, 'SKT-TWIN'); g(70, 2); g(10, 0); g(20, 0); g(30, 0); g(3, 'SKT-TWIN');
  polyline('0', [[-200, 0], [200, 0], [200, 150], [-200, 150]], true);
  attdef('CCT', 'Circuit', 0);
  g(0, 'ENDBLK'); g(8, '0');
  g(0, 'BLOCK'); g(8, '0'); g(2, 'DB-PANEL'); g(70, 2); g(10, 0); g(20, 0); g(30, 0); g(3, 'DB-PANEL');
  polyline('0', [[-400, -150], [400, -150], [400, 150], [-400, 150]], true);
  attdef('TAG', 'Board', 250);
  g(0, 'ENDBLK'); g(8, '0');
  g(0, 'BLOCK'); g(8, '0'); g(2, 'RM-TAG'); g(70, 2); g(10, 0); g(20, 0); g(30, 0); g(3, 'RM-TAG');
  g(0, 'CIRCLE'); g(8, '0'); g(10, 0); g(20, 0); g(30, 0); g(40, 350);
  attdef('NAME', 'Room name', 450); attdef('NO', 'Room number', -150);
  g(0, 'ENDBLK'); g(8, '0');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  build({ line, arc, polyline, rect, text, insert, wall });
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

/** A room outline at the wall faces (inset half the wall from the centreline grid). */
const outline = (rect, x1, y1, x2, y2) => {
  const inset = (v, edge) => (v === 0 || v === edge ? EXT / 2 : INT / 2);
  rect('A-ROOM', x1 + inset(x1, W), y1 + inset(y1, H), x2 - inset(x2, W), y2 - inset(y2, H));
};
const grid = (x1, y1, x2, y2, cols, rows) => {
  const pts = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) pts.push([x1 + ((c + 0.5) * (x2 - x1)) / cols, y1 + ((r + 0.5) * (y2 - y1)) / rows]);
  return pts;
};
/** Outside walls with the entrance (ground) or a balcony door (first), and the corridor walls at y 4500 / 6000. */
function shell(d, entrance) {
  d.wall(0, 0, W, 0, EXT, entrance ? [[6200, 1200]] : []);
  d.wall(W, 0, W, H, EXT);
  d.wall(0, H, W, H, EXT, entrance ? [] : [[11500, 1000]]);
  d.wall(0, 0, 0, H, EXT);
  d.polyline('A-STAIR', [[13200, 4600], [15900, 4600], [15900, 5900], [13200, 5900]], true);
  for (let x = 13500; x < 15900; x += 300) d.line('A-STAIR', x, 4600, x, 5900);
}

const gf = drawing((d) => {
  shell(d, true);
  // Bottom row (y 0–4500): kitchen | maid | guest bedroom | electrical / store. Hall y 4500–6000. Top: majlis | living | dining.
  d.wall(0, 4500, W, 4500, INT, [[1500, 900], [5600, 900], [9600, 900], [13700, 900]]);
  d.wall(0, 6000, W, 6000, INT, [[2500, 900], [8000, 1000], [13000, 900]]);
  d.wall(5000, 0, 5000, 4500, INT);
  d.wall(8500, 0, 8500, 4500, INT);
  d.wall(12500, 0, 12500, 4500, INT);
  d.wall(12500, 2200, W, 2200, INT, [[1500, 800]]);
  d.wall(6000, 6000, 6000, H, INT, [[2500, 900]]);
  d.wall(11500, 6000, 11500, H, INT, [[2200, 1000]]);
  const rooms = [
    ['MAJLIS', 0, 6000, 6000, H, true], ['LIVING', 6000, 6000, 11500, H, true], ['DINING', 11500, 6000, W, H, true],
    ['KITCHEN', 0, 0, 5000, 4500, true], ['MAID ROOM', 5000, 0, 8500, 4500, true], ['GUEST BEDROOM', 8500, 0, 12500, 4500, false],
    ['ELECTRICAL ROOM', 12500, 0, W, 2200, true], ['STORE', 12500, 2200, W, 4500, false], ['HALL', 0, 4500, 13000, 6000, false]
  ];
  for (const [name, x1, y1, x2, y2, outlined] of rooms) {
    if (outlined) outline(d.rect, x1, y1, x2, y2);
    if (name === 'GUEST BEDROOM') d.insert('RM-TAG', 'A-ROOM-NAME', (x1 + x2) / 2, y2 - 1300, { NAME: 'Guest bedroom', NO: 'G.06' });
    else d.text('A-ROOM-NAME', (x1 + x2) / 2, y2 - (name === 'HALL' ? 900 : 800), name === 'HALL' ? 250 : 300, name);
  }
  d.insert('DB-PANEL', 'E-BOARD', 14250, 600, { TAG: 'SMDB-GF' });
  d.insert('DB-PANEL', 'E-BOARD', 14250, 1600, { TAG: 'DB-GF1' });
  for (const [x, y] of grid(6000, 6000, 11500, 11500, 4, 2)) d.insert('L1', 'E-LIGHT', x, y, { CCT: 'DB-GF1/R1' });
  for (const [x, y] of grid(0, 6000, 6000, 11500, 3, 2)) d.insert('L1', 'E-LIGHT', x, y, { CCT: 'DB-GF1/Y1' });
  for (const [x, y] of grid(0, 0, 5000, 4000, 2, 2)) d.insert('L1', 'E-LIGHT', x, y, { CCT: 'DB-GF1/Y2' });
  for (const x of [7000, 9000, 10500]) d.insert('SKT-TWIN', 'E-POWER', x, 6250, { CCT: 'DB-GF1/Y5' });
  for (const x of [1000, 2500, 4000]) d.insert('SKT-TWIN', 'E-POWER', x, 250, { CCT: 'DB-GF1/B7' });
  for (const y of [7000, 9500]) d.insert('SKT-TWIN', 'E-POWER', 250, y, { CCT: 'DB-GF1/B6' });
  // Cable routes: SMDB-GF → DB-GF1, and DB-GF1 along the hall to a living room light.
  d.polyline('E-CABLE', [[13850, 600], [13300, 600], [13300, 1600], [13850, 1600]]);
  d.polyline('E-CABLE', [[13850, 1800], [12800, 1800], [12800, 5250], [7400, 5250], [7400, 7375]]);
  // Tray runs: A up the electrical room side, B along the hall.
  d.polyline('E-TRAY', [[12900, 300], [12900, 5100]]);
  d.polyline('E-TRAY', [[12900, 5100], [6500, 5100]]);
  d.text('E-TRAY', 12600, 2700, 200, 'TRAY A');
  d.text('E-TRAY', 9500, 5350, 200, 'TRAY B');
  ['SAMPLE G+1 VILLA - GROUND FLOOR (LV DESIGN STUDIO TEST PLAN, NOT FOR CONSTRUCTION). UNITS: MM.',
    'A-ROOM OUTLINES: MAJLIS, LIVING, DINING, KITCHEN, MAID, ELECTRICAL. NO OUTLINE (CLICK INSIDE): GUEST BEDROOM, STORE, HALL.',
    'BOARDS BY TAG ATTRIBUTE; LIGHTS / SOCKETS WITH CCT; ROUTES ON E-CABLE; TRAYS ON E-TRAY (TRAY A, TRAY B).'
  ].forEach((s, i) => d.text('NOTES', W / 2, -900 - i * 450, 220, s));
});

const ff = drawing((d) => {
  shell(d, false);
  // Bottom row: bedroom 1 | bath 1 | bedroom 2 | bath 2. Lobby y 4500–6000. Top: master bedroom | master bath | family lounge.
  d.wall(0, 4500, W, 4500, INT, [[1500, 900], [5800, 800], [9600, 900], [13700, 800]]);
  d.wall(0, 6000, W, 6000, INT, [[2500, 900], [7500, 800], [11000, 900]]);
  d.wall(5000, 0, 5000, 4500, INT);
  d.wall(7500, 0, 7500, 4500, INT);
  d.wall(12500, 0, 12500, 4500, INT);
  d.wall(7000, 6000, 7000, H, INT, [[2000, 800]]);
  d.wall(9500, 6000, 9500, H, INT);
  const rooms = [
    ['MASTER BEDROOM', 0, 6000, 7000, H, false], ['MASTER BATH', 7000, 6000, 9500, H, true], ['FAMILY LOUNGE', 9500, 6000, W, H, false],
    ['BEDROOM 1', 0, 0, 5000, 4500, true], ['BATH 1', 5000, 0, 7500, 4500, false], ['BEDROOM 2', 7500, 0, 12500, 4500, false],
    ['BATH 2', 12500, 0, W, 4500, true], ['LOBBY', 0, 4500, 13000, 6000, false]
  ];
  for (const [name, x1, y1, x2, y2, outlined] of rooms) {
    if (outlined) outline(d.rect, x1, y1, x2, y2);
    d.text('A-ROOM-NAME', (x1 + x2) / 2, y2 - (name === 'LOBBY' ? 900 : 800), name === 'LOBBY' ? 250 : 300, name);
  }
  d.insert('DB-PANEL', 'E-BOARD', 600, 5250, { TAG: 'SMDB-FF' });
  for (const [x, y] of grid(0, 6000, 7000, 11500, 3, 2)) d.insert('L1', 'E-LIGHT', x, y);
  for (const [x, y] of grid(9500, 6000, W, 11500, 3, 2)) d.insert('L1', 'E-LIGHT', x, y);
  for (const [x, y] of grid(0, 4500, 13000, 6000, 5, 1)) d.insert('L1', 'E-LIGHT', x, y);
  d.polyline('E-TRAY', [[1200, 5100], [12800, 5100]]);
  d.text('E-TRAY', 6500, 5350, 200, 'TRAY C');
  ['SAMPLE G+1 VILLA - FIRST FLOOR (LV DESIGN STUDIO TEST PLAN, NOT FOR CONSTRUCTION). UNITS: MM.',
    'A-ROOM OUTLINES: MASTER BATH, BEDROOM 1, BATH 2 ONLY. THE OTHER ROOMS: CLICK INSIDE, THEN PICK NAME.',
    'BOARD SMDB-FF BY TAG ATTRIBUTE; TRAY C ON E-TRAY.'
  ].forEach((s, i) => d.text('NOTES', W / 2, -900 - i * 450, 220, s));
});

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'samples');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'sample-villa-gf.dxf'), gf);
writeFileSync(join(dir, 'sample-villa-ff.dxf'), ff);
console.log(`Wrote ${join(dir, 'sample-villa-gf.dxf')} and sample-villa-ff.dxf`);
