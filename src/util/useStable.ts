import { useRef } from 'react';

/** The same object until its content changes (compared as JSON), so a value rebuilt on every
 * render can be a hook dependency without re-running the memo or effect each time. */
export function useStable<T>(value: T): T {
  const key = JSON.stringify(value);
  const ref = useRef({ key, value });
  if (ref.current.key !== key) ref.current = { key, value };
  return ref.current.value;
}
