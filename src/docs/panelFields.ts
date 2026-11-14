import { supplyAuthorityOf } from '../model/designReference';
import { boardLocation } from '../model/levels';
import type { Project } from '../types';
import { buildMdSheet, type MdColKey } from './mdSheet';
import { projectFields, type Fields, type Value } from './scheduleFields';

/** The values of a panel's "connected load, maximum demand & kWh metering" form, by field key: the fields of a linked panel sheet
 * (sheetLink.ts). Built on buildMdSheet, so a linked sheet shows what the app's own form shows. No ExcelJS here. */

const DEVICES: MdColKey[] = ['ACB', 'MCCB', 'ISOL'], METERS: MdColKey[] = ['1-PH', '3-PH', 'CT'];
/** A text that is a plain number (the form writes kW as "12.50") becomes a number; other texts stay as written. */
const asValue = (v: string | number | undefined): Value => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v ?? '');

/** Values of one panel: the sheet's fields and one set per outgoing feeder and spare way, in the form's order. */
export function panelData(project: Project, boardId: string, at = new Date()): { fields: Fields; rows: Fields[] } {
  const t = buildMdSheet(project, boardId), board = t.board;
  const cell = (y: number, k: MdColKey) => asValue(t.data[y][t.keys.indexOf(k)]);
  const held = (y: number, ks: MdColKey[]) => ks.find((k) => String(cell(y, k)) !== '');
  const total = (k: MdColKey) => asValue(t.totals[t.keys.indexOf(k)]);
  const upstream = board.upstreamId && project.boards.some((b) => b.id === board.upstreamId) ? board.upstreamId : undefined;
  const dev = held(0, DEVICES);
  const fields: Fields = {
    ...projectFields(project, at),
    'board.id': board.id, 'board.name': board.name, 'board.location': boardLocation(project, board), 'board.fedFrom': upstream ?? board.supply?.fedFrom ?? supplyAuthorityOf(project),
    'incomer.poles': cell(0, 'sptp'), 'incomer.device': dev ?? '', 'incomer.rating': dev ? cell(0, dev) : '', 'incomer.fault': cell(0, 'fault'), 'incomer.cores': cell(0, 'cores'),
    'incomer.cableType': cell(0, 'type'), 'incomer.size': cell(0, 'size'), 'incomer.ecc': cell(0, 'ecc'), 'incomer.length': cell(0, 'length'),
    'total.R': total('R'), 'total.Y': total('Y'), 'total.B': total('B'), 'panel.tcl': total('tcl'), 'panel.df': t.form.demandFactor, 'panel.mdl': total('mdl')
  };
  const rows: Fields[] = [];
  t.rows.forEach((r, y) => {
    if (r.type !== 'feeder' && r.type !== 'way') return;
    const d = held(y, DEVICES), m = held(y, METERS);
    rows.push({
      'row.sl': rows.length + 1, 'row.name': cell(y, 'name'), 'row.to': r.type === 'feeder' ? r.toBoard?.id ?? '' : '', 'row.poles': cell(y, 'sptp'), 'row.device': d ?? '', 'row.rating': d ? cell(y, d) : '',
      'row.fault': cell(y, 'fault'), 'row.cores': cell(y, 'cores'), 'row.cableType': cell(y, 'type'), 'row.size': cell(y, 'size'), 'row.ecc': cell(y, 'ecc'), 'row.length': cell(y, 'length'),
      'row.R': cell(y, 'R'), 'row.Y': cell(y, 'Y'), 'row.B': cell(y, 'B'), 'row.tcl': cell(y, 'tcl'), 'row.mdl': cell(y, 'mdl'), 'row.meter': m ?? '', 'row.remarks': cell(y, 'remarks')
    });
  });
  return { fields, rows };
}

/** One stable key per row of panelData(...).rows, same order: a feeder's uid (else its id), a spare way's id with "spare:" before it. */
export function panelRowKeys(project: Project, boardId: string): string[] {
  return buildMdSheet(project, boardId).rows.flatMap((r) => (r.type === 'feeder' ? [r.feeder.uid ?? r.feeder.id] : r.type === 'way' ? [`spare:${r.way.id}`] : []));
}
