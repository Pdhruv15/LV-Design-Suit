import type { DeviceDim } from '../model/enclosureLibrary';

/** Manufacturer device dimensions (mm), supplied by the owner. Built in and
 * read-only: used for enclosure sizing after the user's own records and
 * before the typical widths. DIN-rail devices are counted in 18 mm modules
 * (width ÷ 18, rounded: a 35 mm RCCB is 2 modules); chassis and door-mounted
 * devices have no module width (0) and keep their W × H × D for layouts. */

type Row = [id: string, kind: DeviceDim['kind'], manufacturer: string, series: string, poles: number, polesText: string, ratingMinA: number | undefined, ratingMaxA: number | undefined, mounting: string, w: number, h: number, d: number];

const ROWS: Row[] = [
  ['mcb_1p', 'MCB', 'Schneider Electric', 'Acti9 iC60N', 1, '1P', 1, 63, 'DIN Rail', 18, 85, 78.5],
  ['mcb_2p', 'MCB', 'Schneider Electric', 'Acti9 iC60N', 2, '2P', 1, 63, 'DIN Rail', 36, 85, 78.5],
  ['mcb_3p', 'MCB', 'Schneider Electric', 'Acti9 iC60N', 3, '3P', 1, 63, 'DIN Rail', 54, 85, 78.5],
  ['mcb_4p', 'MCB', 'Schneider Electric', 'Acti9 iC60N', 4, '4P', 1, 63, 'DIN Rail', 72, 85, 78.5],
  ['rccb_2p', 'RCCB', 'ABB', 'F200', 2, '2P', 16, 63, 'DIN Rail', 35, 85, 69],
  ['rccb_4p', 'RCCB', 'ABB', 'F200', 4, '4P', 16, 63, 'DIN Rail', 70, 85, 69],
  ['rcbo_1pn', 'RCBO', 'Siemens', '5SV1', 1, '1P+N', 6, 32, 'DIN Rail', 18, 90, 77],
  ['mccb_160a_3p', 'MCCB', 'Schneider Electric', 'ComPacT NSX160', 3, '3P', 100, 160, 'Base Mount / Panel', 105, 161, 86],
  ['mccb_250a_3p', 'MCCB', 'Schneider Electric', 'ComPacT NSX250', 3, '3P', 160, 250, 'Base Mount / Panel', 105, 161, 86],
  ['mccb_630a_3p', 'MCCB', 'Schneider Electric', 'ComPacT NSX630', 3, '3P', 400, 630, 'Base Mount / Panel', 140, 255, 110],
  ['acb_1600a_3p_fixed', 'ACB', 'ABB', 'Emax E1.2', 3, '3P', 800, 1600, 'Fixed', 210, 296, 270],
  ['acb_3200a_3p_drawout', 'ACB', 'ABB', 'Emax E2.2', 3, '3P', 2000, 3200, 'Withdrawable / Drawout', 317, 425, 383],
  ['spd_3pn', 'SPD', 'Schneider Electric', 'iPRD', 4, '3P+N', undefined, undefined, 'DIN Rail', 72, 90, 69],
  ['contactor_40a_4p', 'Contactor', 'ABB', 'EN40', 4, '4P', undefined, 40, 'DIN Rail', 54, 85, 65],
  ['digital_meter_96x96', 'Meter', 'Schneider Electric', 'EasyLogic PM2200', 0, '—', undefined, undefined, 'Door Cutout', 96, 96, 76],
  ['indicator_light', 'Pilot light', 'Siemens', 'SIRIUS 3SB3', 0, '—', undefined, undefined, '22mm Cutout', 29.5, 29.5, 49.5]
];

export const BRAND_DEVICES: DeviceDim[] = ROWS.map(([id, kind, manufacturer, series, poles, polesText, ratingMinA, ratingMaxA, mounting, w, h, d]) => ({
  id: `brand-${id}`, manufacturer, model: `${series} ${polesText}`, kind, poles,
  ...(ratingMinA !== undefined ? { ratingMinA } : {}), ...(ratingMaxA !== undefined ? { ratingMaxA } : {}),
  modules: mounting === 'DIN Rail' ? Math.round(w / 18) : 0, mounting, widthMm: w, heightMm: h, depthMm: d, note: 'Manufacturer data (built in)'
}));
