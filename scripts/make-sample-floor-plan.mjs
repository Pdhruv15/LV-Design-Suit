// Writes docs/samples/sample-ground-floor-plan.dxf: a ground-floor plan of the built-in sample project's villa
// (R12 DXF, millimetres) for trying the OpenCADStudio link — rooms with names, the SMDB-GF and DB-GF1 board
// symbols, light and socket fixtures with CCT circuit attributes, two unlinked cable routes and two unlinked tray runs.
// Run: node scripts/make-sample-floor-plan.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = [];
const g = (code, value) => out.push(String(code), String(value));
const layers = { 'A-WALL': 8, 'A-ROOM': 9, 'A-ROOM-NAME': 7, 'E-BOARD': 1, 'E-LIGHT': 2, 'E-POWER': 3, 'E-CABLE': 6, 'E-TRAY': 4, NOTES: 7 };

function polyline(layer, points, closed = false) {
  g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
  for (const [x, y] of points) { g(0, 'VERTEX'); g(8, layer); g(10, x); g(20, y); g(30, 0); }
  g(0, 'SEQEND'); g(8, layer);
}
const rect = (layer, x1, y1, x2, y2) => polyline(layer, [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], true);
function text(layer, x, y, height, value, centre = false) {
  g(0, 'TEXT'); g(8, layer); g(10, x); g(20, y); g(30, 0); g(40, height); g(1, value);
  if (centre) { g(72, 1); g(11, x); g(21, y); g(31, 0); }
}
function attdef(tag, prompt, y) { g(0, 'ATTDEF'); g(8, '0'); g(10, 250); g(20, y); g(30, 0); g(40, 150); g(1, ''); g(3, prompt); g(2, tag); g(70, 0); }
function insert(block, layer, x, y, attributes) {
  g(0, 'INSERT'); g(8, layer); g(66, 1); g(2, block); g(10, x); g(20, y); g(30, 0);
  for (const [tag, value] of Object.entries(attributes)) { g(0, 'ATTRIB'); g(8, layer); g(10, x + 250); g(20, y); g(30, 0); g(40, 150); g(1, value); g(2, tag); g(70, 0); }
  g(0, 'SEQEND'); g(8, layer);
}

// ---- header, tables
g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4);
g(9, '$EXTMIN'); g(10, -1000); g(20, -3000); g(30, 0); g(9, '$EXTMAX'); g(10, 25000); g(20, 17000); g(30, 0); g(0, 'ENDSEC');
g(0, 'SECTION'); g(2, 'TABLES');
g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1); g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0); g(0, 'ENDTAB');
g(0, 'TABLE'); g(2, 'LAYER'); g(70, Object.keys(layers).length + 1);
for (const [name, colour] of [['0', 7], ...Object.entries(layers)]) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, colour); g(6, 'CONTINUOUS'); }
g(0, 'ENDTAB'); g(0, 'ENDSEC');

// ---- blocks: light, twin socket, distribution board
g(0, 'SECTION'); g(2, 'BLOCKS');
g(0, 'BLOCK'); g(8, '0'); g(2, 'L1'); g(70, 2); g(10, 0); g(20, 0); g(30, 0); g(3, 'L1');
g(0, 'CIRCLE'); g(8, '0'); g(10, 0); g(20, 0); g(30, 0); g(40, 200);
g(0, 'LINE'); g(8, '0'); g(10, -140); g(20, -140); g(30, 0); g(11, 140); g(21, 140); g(31, 0);
g(0, 'LINE'); g(8, '0'); g(10, -140); g(20, 140); g(30, 0); g(11, 140); g(21, -140); g(31, 0);
attdef('CCT', 'Circuit', 0);
g(0, 'ENDBLK'); g(8, '0');
g(0, 'BLOCK'); g(8, '0'); g(2, 'SKT-TWIN'); g(70, 2); g(10, 0); g(20, 0); g(30, 0); g(3, 'SKT-TWIN');
g(0, 'POLYLINE'); g(8, '0'); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, 1);
for (const [x, y] of [[-200, 0], [200, 0], [200, 150], [-200, 150]]) { g(0, 'VERTEX'); g(8, '0'); g(10, x); g(20, y); g(30, 0); }
g(0, 'SEQEND'); g(8, '0');
attdef('CCT', 'Circuit', 0);
g(0, 'ENDBLK'); g(8, '0');
g(0, 'BLOCK'); g(8, '0'); g(2, 'DB-PANEL'); g(70, 2); g(10, 0); g(20, 0); g(30, 0); g(3, 'DB-PANEL');
g(0, 'POLYLINE'); g(8, '0'); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, 1);
for (const [x, y] of [[-400, -150], [400, -150], [400, 150], [-400, 150]]) { g(0, 'VERTEX'); g(8, '0'); g(10, x); g(20, y); g(30, 0); }
g(0, 'SEQEND'); g(8, '0');
attdef('TAG', 'Board', 250);
g(0, 'ENDBLK'); g(8, '0');
// Room tag: NAME and NO attributes (as many architects tag rooms).
g(0, 'BLOCK'); g(8, '0'); g(2, 'RM-TAG'); g(70, 2); g(10, 0); g(20, 0); g(30, 0); g(3, 'RM-TAG');
g(0, 'CIRCLE'); g(8, '0'); g(10, 0); g(20, 0); g(30, 0); g(40, 350);
attdef('NAME', 'Room name', 450);
attdef('NO', 'Room number', -150);
g(0, 'ENDBLK'); g(8, '0');
g(0, 'ENDSEC');

// ---- entities
g(0, 'SECTION'); g(2, 'ENTITIES');
rect('A-WALL', 0, 0, 24000, 16000);
const rooms = [
  ['MAJLIS', 0, 8000, 8000, 16000], ['LIVING', 8000, 8000, 18000, 16000], ['DINING', 18000, 8000, 24000, 16000],
  ['MAID ROOM', 0, 0, 6000, 8000], ['GUEST BEDROOM', 6000, 0, 12000, 8000], ['KITCHEN', 12000, 0, 20000, 8000],
  ['STORE ROOM', 20000, 0, 24000, 4000], ['ELECTRICAL ROOM', 20000, 4000, 24000, 8000]
];
for (const [name, x1, y1, x2, y2] of rooms) {
  rect('A-ROOM', x1, y1, x2, y2);
  // The guest bedroom is named by a room tag block instead of a text.
  if (name === 'GUEST BEDROOM') insert('RM-TAG', 'A-ROOM-NAME', (x1 + x2) / 2, y2 - 1200, { NAME: 'Guest bedroom', NO: 'G.05' });
  else text('A-ROOM-NAME', (x1 + x2) / 2, y2 - 700, 300, name, true);
}
// Boards: the TAG attribute names the board.
insert('DB-PANEL', 'E-BOARD', 22000, 6000, { TAG: 'SMDB-GF' });
insert('DB-PANEL', 'E-BOARD', 22000, 1500, { TAG: 'DB-GF1' });
// Lights (L1) — circuits as in the sample design, except Living: 14 on the plan, 12 in the design.
const grid = (x1, y1, x2, y2, cols, rows) => {
  const pts = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) pts.push([x1 + ((c + 0.5) * (x2 - x1)) / cols, y1 + ((r + 0.5) * (y2 - y1)) / rows]);
  return pts;
};
for (const [x, y] of grid(8000, 8000, 18000, 15000, 7, 2)) insert('L1', 'E-LIGHT', x, y, { CCT: 'DB-GF1/R1' });
for (const [x, y] of grid(0, 8000, 8000, 15000, 5, 2)) insert('L1', 'E-LIGHT', x, y, { CCT: 'DB-GF1/Y1' });
for (const [x, y] of grid(12000, 0, 20000, 7000, 4, 2)) insert('L1', 'E-LIGHT', x, y, { CCT: 'DB-GF1/Y2' });
for (const [x, y] of grid(18000, 8000, 24000, 15000, 3, 2)) insert('L1', 'E-LIGHT', x, y, { CCT: 'DB-GF1/B2' });
// Twin sockets (SKT-TWIN = 2 × S13) — Living 4 (8 sockets, as designed); Kitchen 3 (6 sockets, design has 5).
for (const x of [9000, 12000, 15000, 17000]) insert('SKT-TWIN', 'E-POWER', x, 8400, { CCT: 'DB-GF1/Y5' });
for (const x of [13000, 15500, 18000]) insert('SKT-TWIN', 'E-POWER', x, 400, { CCT: 'DB-GF1/B7' });
// Cable routes (not linked yet): SMDB-GF → DB-GF1, and DB-GF1 → Living lighting.
polyline('E-CABLE', [[21600, 6000], [21000, 6000], [21000, 1500], [21600, 1500]]);
polyline('E-CABLE', [[21600, 1800], [19500, 1800], [19500, 9000], [13000, 9000], [13000, 11500]]);
// Tray runs (not linked yet): A up the corridor beside the kitchen, B along to the living room. The second cable
// route runs along A, then B.
polyline('E-TRAY', [[19650, 1500], [19650, 9150]]);
polyline('E-TRAY', [[19650, 9150], [12500, 9150]]);
// Notes
const notes = [
  'SAMPLE GROUND FLOOR PLAN - LV DESIGN STUDIO DEMONSTRATION PROJECT (NOT FOR CONSTRUCTION). UNITS: MM.',
  'LOADS FROM CAD: L1 = LIBRARY REFERENCE L1; MAP SKT-TWIN TO S13 x 2. CIRCUIT FROM THE CCT ATTRIBUTE.',
  'CABLE LENGTHS: SELECT A MAGENTA ROUTE ON E-CABLE, CHOOSE THE FEEDER, LINK SELECTION, THEN PULL LENGTHS.',
  'BOARD LOCATIONS: BOARDS ARE FOUND BY THEIR TAG ATTRIBUTE; ROOMS ARE CLOSED OUTLINES ON A-ROOM.',
  'TRAY ROUTES: LINK THE CYAN RUNS ON E-TRAY AS A (VERTICAL) AND B, LINK THE CABLE ROUTES, THEN PULL TRAY ROUTES.',
  'ROOMS AND AREAS: A-ROOM = ROOM OUTLINE, A-ROOM-NAME = ROOM NAME (TEXTS AND THE RM-TAG BLOCK).'
];
notes.forEach((line, i) => text('NOTES', 0, -800 - i * 450, 250, line));
g(0, 'ENDSEC'); g(0, 'EOF');

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'samples', 'sample-ground-floor-plan.dxf');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, out.join('\r\n') + '\r\n');
console.log(`Wrote ${file}`);
