import type { PluginMarketListing } from '../../../../../shared/plugin-market';
import { resolveApi, syncRendererPlugins } from './usePluginMarket';

/**
 * Finds the installed market listing behind a renderer plugin id. A Canvas
 * plugin id is its package name, so it matches `listing.name`. Built-in
 * plugins have no listing and return null.
 */
export const findInstalledListing = async (
  pluginId: string,
): Promise<PluginMarketListing | null> => {
  const api = resolveApi();
  if (!api) return null;
  const result = await api.list();
  if (!result.ok || !result.snapshot) return null;
  return result.snapshot.listings.find(
    (listing) => listing.installState === 'installed' && listing.name === pluginId,
  ) ?? null;
};

/** Uninstalls a market listing and drops its renderer half from this window. */
export const uninstallListing = async (listingId: string): Promise<{ ok: boolean; error?: string }> => {
  const api = resolveApi();
  if (!api) return { ok: false, error: 'Plugin market is unavailable' };
  const result = await api.uninstall(listingId);
  if (!result.ok) return { ok: false, error: result.error };
  await syncRendererPlugins();
  return { ok: true };
};
