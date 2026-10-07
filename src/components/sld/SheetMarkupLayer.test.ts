import { describe, expect, it } from 'vitest';
import { anchorAt, arrowFromDrag, panelsIn, type SheetAnchor } from './SheetMarkupLayer';

const anchors: SheetAnchor[] = [
  { target: 'MDB-1', x: 10, y: 10, w: 100, h: 20 },
  { target: 'SMDB-GF', x: 10, y: 40, w: 40, h: 20 },
  { target: 'f:F1', x: 20, y: 15, w: 4, h: 10 }
];

describe('sheet anchors', () => {
  it('takes the panels whose centre is inside the dragged box, not circuits', () => {
    expect(panelsIn(anchors, [0, 35], [60, 70])).toEqual(['SMDB-GF']);
    expect(panelsIn(anchors, [120, 0], [0, 80])).toEqual(['MDB-1', 'SMDB-GF']);
  });
  it('prefers the circuit over the panel around it', () => {
    expect(anchorAt(anchors, [22, 20])?.target).toBe('f:F1');
    expect(anchorAt(anchors, [80, 20])?.target).toBe('MDB-1');
    expect(anchorAt(anchors, [200, 200])).toBeUndefined();
  });
  it('turns a drag into a direction and a length in drawing units', () => {
    expect(arrowFromDrag('MDB-1', [50, 50], [70, 40], 0.25, 'Existing')).toEqual({ target: 'MDB-1', text: 'Existing', dir: 'ne', len: 80 });
    expect(arrowFromDrag('MDB-1', [50, 50], [45, 60], 0.25, 'x').dir).toBe('sw');
    expect(arrowFromDrag('MDB-1', [50, 50], [51, 60], 0.25, 'x').len).toBe(30);
  });
});
