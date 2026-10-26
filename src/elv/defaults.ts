/** Default rules and device data for the ELV estimate (src/elv/estimate.ts). TYPICAL VALUES — VERIFY for each
 * project against the authority's requirements (UAE Fire and Life Safety Code, SIRA, TDRA) and the chosen products.
 * A project overrides any of them in `project.elv`. Room-based counts are estimates for loads, not layouts. */

export const ELV_SYSTEMS = ['fire-alarm', 'cctv', 'access-control', 'ict', 'public-address'] as const;
export type ElvSystem = typeof ELV_SYSTEMS[number];

/** Devices in a room: one per `m2` of floor area (0 = not by area), and at least `min` per room. */
export interface Density { m2: number; min: number }

export interface RoomRule {
  detector: 'smoke' | 'heat' | 'none';
  detectorM2: Density;
  sounder: Density;
  camera: Density;
  door: Density; // access-controlled doors
  dataPort: Density;
  accessPoint: Density;
  speaker: Density;
  speakerKind: 'ceiling' | 'horn';
}

const d = (m2: number, min = 0): Density => ({ m2, min });
const none = d(0);
const rule = (r: Partial<RoomRule>): RoomRule => ({
  detector: 'smoke', detectorM2: d(75, 1), sounder: d(150), camera: none, door: none, dataPort: d(20), accessPoint: d(200), speaker: d(40), speakerKind: 'ceiling', ...r
});

/** Per room type ID (DEFAULT_ROOM_TYPES); `default` for any other type. */
export const DEFAULT_RULES: Record<string, RoomRule> = {
  default: rule({}),
  apartment: rule({ sounder: d(0, 1), dataPort: d(20, 1), accessPoint: d(100, 1), speaker: none }),
  villa: rule({ sounder: d(0, 1), dataPort: d(20, 1), accessPoint: d(100, 1), speaker: none }),
  office: rule({ sounder: d(100), door: d(0, 1), dataPort: d(6, 2), accessPoint: d(150, 1), speaker: d(30) }),
  retail: rule({ camera: d(50, 1), door: d(0, 1), accessPoint: d(200, 1) }),
  fnb: rule({ sounder: d(100), camera: d(60, 1), dataPort: d(30, 1), accessPoint: d(150, 1), speaker: d(30) }),
  hotel: rule({ sounder: d(0, 1), dataPort: d(15, 2), accessPoint: d(60, 1), speaker: d(30, 1) }),
  lobby: rule({ sounder: d(100, 1), camera: d(100, 1), door: d(0, 1), dataPort: none, accessPoint: d(250), speaker: d(30, 1) }),
  toilet: rule({ detector: 'none', detectorM2: none, sounder: none, dataPort: none, accessPoint: none, speaker: none }),
  gym: rule({ sounder: d(100), camera: d(100, 1), door: d(0, 1), dataPort: d(50), accessPoint: d(150, 1), speaker: d(30) }),
  parking: rule({ detector: 'heat', detectorM2: d(36), sounder: d(300), camera: d(250, 1), dataPort: none, accessPoint: none, speaker: d(200), speakerKind: 'horn' }),
  plant: rule({ sounder: d(0, 1), camera: d(0, 1), door: d(0, 1), dataPort: d(0, 2), accessPoint: none, speaker: d(0, 1), speakerKind: 'horn' }),
  store: rule({ sounder: none, dataPort: none, accessPoint: none, speaker: none }),
  living: rule({ sounder: none, dataPort: d(15, 1), accessPoint: d(0, 1), speaker: none }),
  bedroom: rule({ sounder: none, dataPort: d(0, 1), accessPoint: none, speaker: none }),
  kitchen: rule({ detector: 'heat', detectorM2: d(36, 1), sounder: none, dataPort: none, accessPoint: none, speaker: none }),
  bathroom: rule({ detector: 'none', detectorM2: none, sounder: none, dataPort: none, accessPoint: none, speaker: none })
};

/** Product data. Currents at 24 V DC for fire alarm, W at the supply for the rest. */
export interface Catalogue {
  fireAlarm: {
    detectorQuiescentMa: number; detectorAlarmMa: number; sounderQuiescentMa: number; sounderAlarmMa: number;
    devicesPerLoop: number; loopsPerPanel: number; panelQuiescentMa: number; panelAlarmMa: number;
    standbyH: number; alarmH: number; batteryFactor: number; rechargeH: number; chargerV: number; efficiency: number; pf: number;
  };
  cctv: { cameraW: number; switchPorts: number; switchBudgetW: number; switchSelfW: number; nvrChannels: number; nvrW: number; upsEfficiency: number; spare: number; pf: number };
  access: { readerW: number; lockW: number; doorsPerController: number; controllerW: number; psuEfficiency: number; chargeAllowance: number; spare: number; pf: number };
  ict: { accessPointW: number; switchPorts: number; switchBudgetW: number; switchSelfW: number; floorRackW: number; coreRackW: number; upsEfficiency: number; spare: number; pf: number };
  pa: { ceilingTapW: number; hornTapW: number; headroom: number; amplifierW: number; amplifierIdleW: number; efficiency: number; rackW: number; pf: number };
}

export const DEFAULT_CATALOGUE: Catalogue = {
  fireAlarm: {
    detectorQuiescentMa: 0.3, detectorAlarmMa: 5, sounderQuiescentMa: 0.3, sounderAlarmMa: 15,
    devicesPerLoop: 125, loopsPerPanel: 4, panelQuiescentMa: 200, panelAlarmMa: 500,
    standbyH: 24, alarmH: 0.5, batteryFactor: 1.25, rechargeH: 24, chargerV: 27.6, efficiency: 0.8, pf: 0.9
  },
  cctv: { cameraW: 12.95, switchPorts: 20, switchBudgetW: 370, switchSelfW: 30, nvrChannels: 64, nvrW: 150, upsEfficiency: 0.9, spare: 1.25, pf: 0.9 },
  access: { readerW: 1.8, lockW: 6, doorsPerController: 4, controllerW: 5, psuEfficiency: 0.8, chargeAllowance: 1.1, spare: 1.25, pf: 0.9 },
  ict: { accessPointW: 25.5, switchPorts: 40, switchBudgetW: 740, switchSelfW: 60, floorRackW: 100, coreRackW: 600, upsEfficiency: 0.9, spare: 1.25, pf: 0.9 },
  pa: { ceilingTapW: 6, hornTapW: 15, headroom: 1.25, amplifierW: 480, amplifierIdleW: 20, efficiency: 0.8, rackW: 100, pf: 0.9 }
};

/** The basis of the defaults, listed with every estimate. */
export const DEFAULT_ASSUMPTIONS: Record<ElvSystem, string[]> = {
  'fire-alarm': [
    'Smoke detector per 75 m², heat detector per 36 m² (kitchens, car parks), at least one per room; toilets and bathrooms none (BS 5839-1 coverage, reduced for walls and beams) — verify against the Fire and Life Safety Code.',
    'Addressable loops of 125 devices, panels of 4 loops, one panel per building (networked panels beyond 4 loops).',
    'Batteries: 1.25 × (quiescent × 24 h + alarm × 0.5 h); recharged to 80 % in 24 h. Panel input = (alarm load + charging) ÷ 0.8 at 27.6 V.',
    'Call points (by exits) are not counted from rooms.'
  ],
  cctv: [
    'Cameras by room type (retail 1 per 50 m², lobbies 1 per 100 m², car parks 1 per 250 m², plant rooms 1 each) — verify against SIRA for the building category.',
    'PoE class 3 (12.95 W) per camera; 24-port PoE switches used to 20 ports, 370 W PoE budget, 30 W each; NVR per 64 cameras, 150 W.',
    'Supply through UPS (90 % efficient), 25 % spare.'
  ],
  'access-control': [
    'Controlled doors: one per office, shop, gym and plant room, one per lobby (entrance).',
    'Per door: reader 1.8 W and maglock 6 W at 12 V; controller with PSU per 4 doors, 5 W; PSU 80 % efficient, 10 % battery charging, 25 % spare.'
  ],
  ict: [
    'Data ports by area (offices 1 per 6 m², at least 2 per office) and Wi-Fi access points (offices 1 per 150 m²), PoE+ 25.5 W per access point.',
    '48-port switches used to 40 ports, 740 W PoE budget, 60 W each; floor rack 100 W per floor with ports; core rack 600 W per building (no servers).',
    'Supply through UPS (90 % efficient), 25 % spare.'
  ],
  'public-address': [
    'Ceiling speakers 1 per 30–40 m² at 6 W tap; car parks horns 1 per 200 m² at 15 W; plant rooms one horn.',
    'Amplifiers 480 W, sized for taps × 1.25 headroom; input at full output (evacuation) = taps ÷ 0.8 + 20 W idle per amplifier; rack 100 W per building.'
  ]
};
