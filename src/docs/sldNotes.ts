/** Standard notes and abbreviations for the SLD sheets. */

export const ABBREVIATIONS: [string, string][] = [
  ['ACB', 'Air circuit breaker'],
  ['APFC', 'Automatic power factor correction'],
  ['ATS', 'Automatic transfer switch'],
  ['CT', 'Current transformer'],
  ['DB', 'Distribution board'],
  ['EFR', 'Earth fault relay'],
  ['ELR', 'Earth leakage relay'],
  ['FP', 'Fire pump'],
  ['FR', 'Fire-rated cable'],
  ['G', 'Generator'],
  ['IL', 'Interlock'],
  ['Icu', 'Ultimate breaking capacity'],
  ['Ik', 'Prospective fault current'],
  ['Ir', 'Long-time (overload) setting'],
  ['ISO', 'Isolator'],
  ['kWh', 'Energy meter'],
  ['MCB', 'Miniature circuit breaker'],
  ['MCC', 'Motor control centre'],
  ['MCCB', 'Moulded case circuit breaker'],
  ['MDB', 'Main distribution board'],
  ['MICC', 'Mineral insulated copper cable'],
  ['N/O', 'Normally open'],
  ['NTS', 'Not to scale'],
  ['OVR', 'Over-voltage relay'],
  ['PF', 'Power factor'],
  ['PFR', 'Power factor relay'],
  ['RCD', 'Residual current device'],
  ['RMU', 'Ring main unit'],
  ['SMDB', 'Sub-main distribution board'],
  ['SPD', 'Surge protection device'],
  ['SWA', 'Steel wire armoured'],
  ['UPS', 'Uninterruptible power supply'],
  ['UVR', 'Under-voltage relay'],
  ['XLPE', 'Cross-linked polyethylene'],
  ['ΔV', 'Voltage drop']
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The abbreviations that appear in the drawing's text (SVG markup). */
export function abbreviationsIn(svg: string): [string, string][] {
  const text = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ')).join(' ') + ' NTS';
  return ABBREVIATIONS.filter(([a]) => new RegExp(`(^|[^A-Za-z])${esc(a)}([^A-Za-z]|$)`).test(text));
}

/** General notes typical of a DEWA / DM LV submission; edit them to suit. */
export const DEWA_GENERAL_NOTES = [
  'All works shall comply with the latest DEWA Regulations for Electrical Installations and IEC 60364.',
  'System: {Voltage}, 3 phase + neutral, 50 Hz, TN-S earthing.',
  'All cables are XLPE/SWA/PVC copper unless noted otherwise; fire-rated cables where marked FR.',
  'Cable sizes are based on the installation method and derating stated in the cable schedule.',
  'Voltage drop is within 4 % from the transformer / DEWA intake to the final load.',
  'Breaking capacity of all devices is not less than the prospective fault level at their point of installation.',
  'All MCCBs / ACBs shall have adjustable thermal and magnetic settings; settings as shown.',
  'Earth leakage protection as per DEWA: 30 mA for socket outlets, 100 mA for lighting.',
  'Contractor to verify loads and cable lengths on site before ordering equipment.',
  'Do not scale from this drawing.'
];
