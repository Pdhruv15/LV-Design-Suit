import { useCallback, useState } from 'react';

/** Undo / redo for a value that is only ever replaced (never mutated), such
 * as the project. Changes within `mergeMs` of each other are one step, so a
 * burst of edits (typing, a paste) undoes together. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** When the last step was recorded (ms); edits closer than mergeMs join it. */
  at: number;
}

export const MAX_STEPS = 100;

export function record<T>(h: History<T>, next: T, now: number, mergeMs = 600): History<T> {
  if (next === h.present) return h;
  const merge = h.past.length > 0 && now - h.at < mergeMs;
  const past = merge ? h.past : [...h.past, h.present].slice(-MAX_STEPS);
  return { past, present: next, future: [], at: now };
}

/** Replaces the value without an undo step (e.g. opening a project). */
export const reset = <T,>(value: T): History<T> => ({ past: [], present: value, future: [], at: 0 });

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], at: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), at: 0 };
}

/** useState with undo / redo. set() takes a value or an updater, like
 * useState's setter; load() replaces the value and clears the history. */
export function useHistory<T>(initial: T) {
  const [h, setH] = useState<History<T>>(() => reset(initial));
  /** step: always a separate undo step (e.g. one drag-and-drop), never
   * merged with the change before it. */
  const set = useCallback((v: T | ((prev: T) => T), opts?: { step?: boolean }) => {
    setH((cur) => record(cur, typeof v === 'function' ? (v as (p: T) => T)(cur.present) : v, Date.now(), opts?.step ? 0 : undefined));
  }, []);
  return {
    value: h.present,
    set,
    load: useCallback((v: T) => setH(reset(v)), []),
    undo: useCallback(() => setH(undo), []),
    redo: useCallback(() => setH(redo), []),
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0
  };
}
