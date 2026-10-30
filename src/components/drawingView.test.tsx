// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isFitClick, isPanPress, isTrackpad, KEY_STEP, viewKey, wheelAction, WHEEL_STEP, ZoomChip } from './drawingView';

const wheel = (deltaY: number, o: { deltaX?: number; deltaMode?: number; ctrlKey?: boolean; wheelDeltaY?: number } = {}) =>
  ({ deltaX: 0, deltaMode: 0, ctrlKey: false, ...o, deltaY });
const key = (k: string, o: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: EventTarget | null } = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, target: null, ...o });

describe('one set of view controls for every drawing', () => {
  it('zooms with a mouse wheel, one step per notch, at the cursor', () => {
    expect(wheelAction(wheel(-100, { wheelDeltaY: 120 }))).toEqual({ zoom: WHEEL_STEP });
    expect(wheelAction(wheel(100, { wheelDeltaY: -120 }))).toEqual({ zoom: 1 / WHEEL_STEP });
    expect(wheelAction(wheel(3, { deltaMode: 1 }))).toEqual({ zoom: 1 / WHEEL_STEP }); // lines: a mouse
  });

  it('pans with two fingers on a trackpad and zooms with a pinch', () => {
    expect(isTrackpad(wheel(6, { wheelDeltaY: -18 }))).toBe(true);
    expect(wheelAction(wheel(6, { wheelDeltaY: -18 }))).toEqual({ pan: [0, 6] });
    expect(wheelAction(wheel(0, { deltaX: 12, wheelDeltaY: 0 }))).toEqual({ pan: [12, 0] }); // sideways
    const pinch = wheelAction(wheel(-4.5, { ctrlKey: true, wheelDeltaY: 13.5 }));
    expect('zoom' in pinch && pinch.zoom).toBeGreaterThan(1);
    expect('zoom' in pinch && pinch.zoom).toBeLessThan(1.1); // smooth, not a whole step
    expect(wheelAction(wheel(-100, { ctrlKey: true, wheelDeltaY: 120 }))).toEqual({ zoom: WHEEL_STEP }); // Ctrl + mouse wheel
  });

  it('reads F / 0, + / −, arrows and G, but not typed text or shortcuts with Ctrl / ⌘', () => {
    expect(['f', 'F', '0'].map((k) => viewKey(key(k)))).toEqual(['fit', 'fit', 'fit']);
    expect(['+', '=', '-', '_'].map((k) => viewKey(key(k)))).toEqual(['in', 'in', 'out', 'out']);
    expect(viewKey(key('ArrowLeft'))).toEqual({ pan: [-1, 0] });
    expect(viewKey(key('g'))).toBe('grid');
    expect(viewKey(key('f'), false)).toBeNull(); // Design CAD: letters go to the command line
    expect(viewKey(key('0'), false)).toBe('fit');
    expect(viewKey(key('f', { metaKey: true }))).toBeNull();
    const input = document.createElement('input');
    expect(viewKey(key('+', { target: input }))).toBeNull();
    expect(viewKey(key('v'))).toBeNull();
    expect(KEY_STEP).toBeGreaterThan(WHEEL_STEP);
  });

  it('pans with the middle button or Space + left button, and fits on a double click of the wheel', () => {
    expect([isPanPress({ button: 1 }, false), isPanPress({ button: 0 }, true), isPanPress({ button: 0 }, false)]).toEqual([true, true, false]);
    expect([isFitClick({ button: 1, detail: 2 }), isFitClick({ button: 1, detail: 1 }), isFitClick({ button: 0, detail: 2 })]).toEqual([true, false, false]);
  });

  it('shows the zoom as a whole percentage that fits the drawing when clicked', () => {
    const html = renderToStaticMarkup(<ZoomChip pct={63.6} onFit={() => {}} />);
    expect(html).toContain('>64 %<');
    expect(html).toContain('click to fit');
  });
});
