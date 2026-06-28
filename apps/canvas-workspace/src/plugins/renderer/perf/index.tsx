import { useLocation } from 'wouter';
import { SettingsIcon } from '../../../renderer/src/components/icons';
import { EXPERIMENTAL_FLAG_PERF_PANEL } from '../../../shared/experimental-features';
import type { RendererCanvasPlugin, RendererCtx } from '../../types';
import { PerfPage } from './PerfPage';

// ── Detachable performance plugin (renderer half) ───────────────────────────
//
// Registers a "/perf" route + sidebar nav item, gated behind the `perf-panel`
// experimental flag (Settings → Experimental, requires window reload). When the
// flag is off, enabledWhen() returns false and the plugin contributes nothing —
// zero route, zero nav item, zero cost.
//
// To remove entirely: delete this folder + src/plugins/main/perf.ts, drop both
// BUILT_IN_* registrations, and remove EXPERIMENTAL_FLAG_PERF_PANEL.

const PerfRoute = ({ invoke }: { invoke: RendererCtx['invoke'] }) => {
  const [, setLocation] = useLocation();
  return <PerfPage invoke={invoke} onBack={() => setLocation('/')} />;
};

export const PerfRendererPlugin: RendererCanvasPlugin = {
  id: 'perf',
  enabledWhen: () =>
    (globalThis as { canvasWorkspace?: { pluginFlags?: Record<string, boolean> } }).canvasWorkspace
      ?.pluginFlags?.[EXPERIMENTAL_FLAG_PERF_PANEL] === true,
  activate(ctx) {
    ctx.registerRoute('/perf', () => <PerfRoute invoke={ctx.invoke} />);
    ctx.registerNavItem({
      id: 'perf',
      path: '/perf',
      label: 'Perf',
      title: 'Performance',
      icon: SettingsIcon,
    });
  },
};
