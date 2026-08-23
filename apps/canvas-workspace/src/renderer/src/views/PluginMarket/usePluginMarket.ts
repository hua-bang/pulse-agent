import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PluginMarketApi,
  PluginMarketListing,
  PluginMarketMutationResult,
  PluginMarketSnapshot,
  PluginMarketSource,
} from '../../../../shared/plugin-market';
import {
  specsFromCanvasPluginsStatus,
  syncFederatedRendererPlugins,
} from '../../../../plugins/renderer';
import { CANVAS_PLUGINS_CHANGED_EVENT } from '../../constants/canvasPlugins';

type CanvasWindow = Window & {
  canvasWorkspace?: Window['canvasWorkspace'] & { pluginMarket?: PluginMarketApi };
};

const resolveApi = (): PluginMarketApi | undefined => (
  (window as CanvasWindow).canvasWorkspace?.pluginMarket
);

const syncRendererPlugins = async (): Promise<void> => {
  const api = (window as CanvasWindow).canvasWorkspace?.canvasPlugins;
  if (!api) return;
  const result = await api.list();
  if (!result.ok || !result.status) {
    throw new Error(result.error ?? 'Canvas plugin status is unavailable');
  }
  window.dispatchEvent(new CustomEvent(CANVAS_PLUGINS_CHANGED_EVENT, { detail: result.status }));
  await syncFederatedRendererPlugins(specsFromCanvasPluginsStatus(result.status));
};

export const usePluginMarket = (
  apiUnavailableMessage: string,
  exploreUnavailableMessage: string,
) => {
  const [snapshot, setSnapshot] = useState<PluginMarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const requestSnapshot = useCallback(async (refresh: boolean) => {
    const sequence = ++requestSequence.current;
    const api = resolveApi();
    if (!api) {
      setError(apiUnavailableMessage);
      setLoading(false);
      return false;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const result = refresh ? await api.refresh() : await api.list();
      if (sequence !== requestSequence.current) return false;
      if (!result.ok || !result.snapshot) {
        setError(result.error ?? apiUnavailableMessage);
        return false;
      }
      setSnapshot(result.snapshot);
      setError(null);
      return true;
    } catch (cause) {
      if (sequence !== requestSequence.current) return false;
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [apiUnavailableMessage]);

  useEffect(() => {
    void requestSnapshot(false);
    return () => {
      requestSequence.current += 1;
    };
  }, [requestSnapshot]);

  const mutate = useCallback(async (
    key: string,
    action: (api: PluginMarketApi) => Promise<PluginMarketMutationResult>,
  ) => {
    const api = resolveApi();
    if (!api) {
      setError(apiUnavailableMessage);
      return false;
    }
    setBusyKey(key);
    setError(null);
    try {
      const result = await action(api);
      if (result.canceled) return false;
      if (!result.ok) {
        setError(result.error ?? apiUnavailableMessage);
        return false;
      }
      if (result.snapshot) setSnapshot(result.snapshot);
      try {
        await syncRendererPlugins();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (result.diagnostics?.length) {
        setError(result.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusyKey(null);
    }
  }, [apiUnavailableMessage]);

  const explore = useCallback(async (listing: PluginMarketListing) => {
    const url = listing.source.kind === 'git' ? listing.source.url?.trim() : undefined;
    const shell = (window as CanvasWindow).canvasWorkspace?.shell;
    if (!url || !shell) {
      setError(exploreUnavailableMessage);
      return false;
    }
    setBusyKey(`explore:${listing.id}`);
    setError(null);
    try {
      const result = await shell.openExternal(url);
      if (!result.ok) {
        setError(result.error ?? exploreUnavailableMessage);
        return false;
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusyKey(null);
    }
  }, [exploreUnavailableMessage]);

  return {
    snapshot,
    loading,
    refreshing,
    busyKey,
    error,
    clearError: () => setError(null),
    refresh: () => requestSnapshot(true),
    install: (id: string) => mutate(`install:${id}`, (api) => api.install(id)),
    uninstall: (id: string) => mutate(`uninstall:${id}`, (api) => api.uninstall(id)),
    connectMcp: (id: string) => mutate(`connect:${id}`, (api) => api.connectMcp(id)),
    explore,
    setNativeEnabled: (id: string, enabled: boolean) => (
      mutate(`native:${id}`, (api) => api.setNativeEnabled(id, enabled))
    ),
    chooseDirectory: () => mutate('directory', (api) => api.chooseDirectory()),
    addGit: (source: PluginMarketSource) => mutate('git', (api) => api.addGit(source)),
  };
};
