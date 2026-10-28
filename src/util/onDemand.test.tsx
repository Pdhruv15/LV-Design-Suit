// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { onDemand } from './onDemand';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows the fallback, then the component once its code has loaded, with its props', async () => {
  let loaded!: () => void;
  const ready = new Promise<void>((r) => { loaded = r; });
  const Hello = onDemand(async () => { await ready; return { default: ({ name }: { name: string }) => <p>Hello {name}</p> }; }, <p>Loading…</p>);
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(<Hello name="Sami" />));
  expect(host.textContent).toBe('Loading…');
  await act(async () => { loaded(); await ready; });
  expect(host.textContent).toBe('Hello Sami');
  act(() => root.unmount());
});
