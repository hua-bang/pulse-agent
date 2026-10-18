import { Suspense, useState, type ComponentProps } from 'react';
import { preloadableLazy } from '../../../shared/preloadableLazy';
import { PulseRouterView } from '../router';

const Launcher = preloadableLazy(() => import('../Launcher').then((module) => ({ default: module.Launcher })));

export const preloadLauncher = Launcher.preload;

/** The launcher page at `/home`; lazy so it stays out of the startup chunk. */
export const HomeRouteView = ({ active, ...props }: ComponentProps<typeof Launcher> & { active: boolean }) => {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!visited && !active) return null;
  return (
    <PulseRouterView name="home" keepAlive>
      <Suspense fallback={null}>
        <Launcher {...props} active={active} />
      </Suspense>
    </PulseRouterView>
  );
};
