import { useMemo, useSyncExternalStore } from 'react';
import {
  getRegisteredNavItems,
  getRegisteredRoutes,
  getRendererPluginRegistryVersion,
  subscribeRendererPluginRegistry,
} from '../../../../plugins/renderer';

/**
 * Plugin routes and nav items, re-read on every renderer registry change.
 * Plugins can activate after mount (market install, federation sync), so a
 * one-shot read would miss them until restart.
 */
export const usePluginRegistry = () => {
  const version = useSyncExternalStore(subscribeRendererPluginRegistry, getRendererPluginRegistryVersion);
  const pluginRoutes = useMemo(() => getRegisteredRoutes().slice(), [version]);
  const pluginNavItems = useMemo(() => getRegisteredNavItems(), [version]);
  return { pluginRoutes, pluginNavItems };
};
