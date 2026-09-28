import { loadTypeOf } from './summary';
import type { Feeder, StarterType } from '../types';

/** Motor starting: how much a motor draws while starting, by starter, and
 * the voltage dip that causes on a generator. */

export const STARTERS: { value: StarterType; label: string; short: string; multiple: number; title: string }[] = [
  { value: 'DOL', label: 'Direct on line', short: 'DOL', multiple: 6, title: 'Direct on line: ≈ 6 × running current while starting' },
  { value: 'SD', label: 'Star-delta', short: 'S/D', multiple: 2, title: 'Star-delta: ≈ 2 × running current (⅓ of DOL)' },
  { value: 'SS', label: 'Soft starter', short: 'SS', multiple: 3, title: 'Soft starter: ≈ 3 × running current (set by its current limit)' },
  { value: 'VFD', label: 'Variable speed drive', short: 'VFD', multiple: 1.2, title: 'VFD: ≈ 1.2 × running current — no inrush' }
];

export const isMotor = (f: Feeder) => !f.feedsBoardId && ['motor', 'fire-pump'].includes(loadTypeOf(f));

/** A motor's starter; direct on line unless set. */
export const starterOf = (f: Feeder): StarterType => f.starter ?? 'DOL';

export const starterInfo = (s: StarterType) => STARTERS.find((x) => x.value === s)!;

/** Running kVA of a motor feeder. */
export const runningKva = (f: Feeder) => f.loadKw / Math.max(f.powerFactor, 0.1);

/** Starting kVA: running kVA × the starter's multiple. */
export const startingKva = (f: Feeder) => runningKva(f) * starterInfo(starterOf(f)).multiple;

/** Generator transient reactance X′d (%), for the motor starting dip. */
export const GENERATOR_XD_TRANSIENT_PCT = 25;
/** Voltage dip limit when the largest motor starts on a generator. */
export const MOTOR_START_DIP_LIMIT_PCT = 15;

/** Voltage dip when a motor starts on a generator:
 * ΔU ≈ S_start / (S_start + S_gen / X′d). */
export const motorStartDipPct = (startKva: number, genKva: number) =>
  (startKva / (startKva + genKva / (GENERATOR_XD_TRANSIENT_PCT / 100))) * 100;
