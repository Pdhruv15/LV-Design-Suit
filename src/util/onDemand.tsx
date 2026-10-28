import { createElement, lazy, Suspense, type Attributes, type ComponentType, type JSX, type ReactNode } from 'react';

/** A component whose code loads the first time it is shown, in its own Suspense boundary, so it can be rendered
 * anywhere like a normal component. For pages and dialogs that are not needed at start-up: their code stays out of
 * the main bundle and the app opens faster. */
export function onDemand<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, fallback: ReactNode = null): (props: P) => JSX.Element {
  const Loaded = lazy(load) as unknown as ComponentType<P>;
  return function OnDemand(props: P) {
    return <Suspense fallback={fallback}>{createElement(Loaded, props as P & Attributes)}</Suspense>;
  };
}
