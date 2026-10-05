import { sampleProject } from '../../src/data/sampleProject';
import type { Project } from '../../src/types';

/** Dense DEWA export: neighbouring feeders, parallel armoured cables,
 * earth leakage, CT metering, a local isolator and a socket arc. */
export const dxfExportProject: Project = {
  ...sampleProject,
  name: 'DXF export clearance check',
  info: {},
  drawing: { sldStyle: 'dewa', symbols: 'iec', cableLabels: 'full', legend: false, abbreviations: false },
  boards: [{ ...sampleProject.boards[0], name: 'CAD test MDB', instruments: false, earthing: { show: false } }],
  feeders: [
    { ...sampleProject.feeders[0], id: 'F1', name: 'Parallel armoured feeder', feedsBoardId: undefined, cableType: 'XLPE/SWA/PVC', parallel: 3, cableCsaMm2: 300, lengthM: 200, breakerRatingA: 630, loadKw: 50, loadType: 'sockets' },
    { ...sampleProject.feeders[0], id: 'F2', name: 'Metered IT', feedsBoardId: undefined, cableType: 'XLPE/SWA/PVC', cableCsaMm2: 4, lengthM: 25, breakerRatingA: 40, breakerType: 'C', loadKw: 10, loadType: 'it', rcdMa: 30, kwhMeter: 'CT' },
    { ...sampleProject.feeders[0], id: 'F3', name: 'Local lighting', feedsBoardId: undefined, cableType: 'XLPE/SWA/PVC', cableCsaMm2: 16, lengthM: 20, breakerRatingA: 80, loadKw: 10, loadType: 'lighting', localIsolator: true }
  ]
};
