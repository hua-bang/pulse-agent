import { lazy, Suspense, type ComponentProps } from 'react';
import { PulseRouterView } from '../router';

const Launcher = lazy(() => import('../Launcher').then((module) => ({ default: module.Launcher })));

/** The launcher page at `/home`; lazy so it stays out of the startup chunk. */
export const HomeRouteView = (props: ComponentProps<typeof Launcher>) => (
  <PulseRouterView name="home">
    <Suspense fallback={null}>
      <Launcher {...props} />
    </Suspense>
  </PulseRouterView>
);
