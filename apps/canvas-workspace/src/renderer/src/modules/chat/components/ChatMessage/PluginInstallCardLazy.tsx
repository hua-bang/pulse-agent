import { lazy, Suspense } from 'react';

// The card lives in the plugin market module, which loads on demand.
const PluginInstallResult = lazy(() => import('../../../plugin-market').then((module) => ({
  default: module.PluginInstallResult,
})));

/** Card for a `canvas_plugin_install` tool result: diagnostics plus "Enable and open". */
export const PluginInstallCardLazy = ({ result }: { result: string }) => (
  <Suspense fallback={null}>
    <PluginInstallResult result={result} />
  </Suspense>
);
