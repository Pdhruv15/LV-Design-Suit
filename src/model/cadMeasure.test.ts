import { describe, expect, it } from 'vitest';
import { angleDeg, areaOf, distance, drawingUnits, ortho } from './cadMeasure';

describe('measuring on a CAD drawing', () => {
  it('knows the drawing units, and takes unitless drawings as millimetres', () => {
    expect(drawingUnits(4)).toEqual({ factor: 0.001, label: 'mm', assumed: false });
    expect(drawingUnits(6).factor).toBe(1);
    expect(drawingUnits(0)).toMatchObject({ label: 'mm', assumed: true });
  });

  it('measures distances, angles, areas and perimeters', () => {
    expect(distance([0, 0], [3000, 4000])).toBe(5000);
    expect(angleDeg([0, 0], [0, 10])).toBe(90);
    expect(angleDeg([0, 0], [10, -10])).toBe(315);
    expect(areaOf([[0, 0], [4000, 0], [4000, 3000], [0, 3000]])).toEqual({ area: 12e6, perimeter: 14000 });
    expect(areaOf([[0, 3000], [4000, 3000], [4000, 0], [0, 0]]).area).toBe(12e6); // either direction
  });

  it('ORTHO keeps a point straight from the last one, along the nearer axis', () => {
    expect(ortho([0, 0], [1000, 120])).toEqual([1000, 0]);
    expect(ortho([0, 0], [80, -900])).toEqual([0, -900]);
  });
});
