import type { SymbolShape } from '../../elv/devices';

type Pt = [number, number];

/** What the ELV layer draws over a plan in Design CAD (drawing units). */

/** A device symbol: a shape with a letter code. */
export interface PlanSymbol { at: Pt; shape: SymbolShape; text: string; filled?: boolean; dim?: boolean; ghost?: boolean; selected?: boolean; rotationDeg?: number }
/** What a device covers: a circle, or a camera's view in bands (nearest first); cut at `clip`. */
export interface PlanCover { at: Pt; r: number; clip?: Pt[]; cone?: { fovDeg: number; rotationDeg: number; bands: number[] } }
/** Squares not covered. */
export interface PlanCells { size: number; at: Pt[] }
