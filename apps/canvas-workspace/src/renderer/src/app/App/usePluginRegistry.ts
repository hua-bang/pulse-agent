import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useChatTargetBroker, waitForActiveChatTarget } from '../../modules/chat';
import {
  getRegisteredNavItems,
  getRegisteredRoutes,
  getRendererPluginRegistryVersion,
  setPluginChatTextHandler,
  subscribeRendererPluginRegistry,
} from '../../../../plugins/renderer';
import { useI18n } from '../../i18n';
import { OPEN_PLUGIN_PAGE_EVENT, requestOpenPluginPage, useAppShell } from '../../shared/appShell';

/**
 * Plugin routes and nav items, re-read on every renderer registry change.
 * Plugins can activate after mount (market install, federation sync), so a
 * one-shot read would miss them until restart. Also handles requests to open
 * a plugin page, and syncs plugins when the main process reports a change.
 */
export const usePluginRegistry = (navigate: (path: string) => void) => {
  const version = useSyncExternalStore(subscribeRendererPluginRegistry, getRendererPluginRegistryVersion);
  const pluginRoutes = useMemo(() => getRegisteredRoutes().slice(), [version]);
  const pluginNavItems = useMemo(() => getRegisteredNavItems(), [version]);

  // `requestOpenPluginPage` may only reach routes that a plugin registered.
  useEffect(() => {
    const handleOpen = (event: Event) => {
      const path = (event as CustomEvent<unknown>).detail;
      if (typeof path !== 'string') return;
      if (getRegisteredRoutes().some((route) => route.path === path)) navigate(path);
    };
    window.addEventListener(OPEN_PLUGIN_PAGE_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_PLUGIN_PAGE_EVENT, handleOpen);
  }, [navigate]);

  // The main process announces plugin changes it made itself (the agent's
  // install tool). Syncing reloads plugins whose files changed.
  useEffect(() => window.canvasWorkspace?.canvasPlugins?.onChanged?.(() => {
    void import('../../modules/plugin-market')
      .then((market) => market.syncRendererPlugins())
      .catch((error: unknown) => console.warn('[canvas-plugins] sync after change failed', error));
  }), []);

  return { pluginRoutes, pluginNavItems };
};

/**
 * Backs `RendererCtx.addTextToChat`: appends the text to the active chat
 * composer, opening the chat first when no composer is mounted.
 */
export const usePluginChatBridge = (openChat: () => void) => {
  const broker = useChatTargetBroker();
  useEffect(() => {
    setPluginChatTextHandler(async (text) => {
      let receipt = await broker.deliver({ kind: 'text', text });
      if (receipt.status === 'unavailable' && !receipt.target) {
        openChat();
        if (await waitForActiveChatTarget(broker)) receipt = await broker.deliver({ kind: 'text', text });
      }
      return receipt.status;
    });
    return () => setPluginChatTextHandler(null);
  }, [broker, openChat]);
};

/**
 * Shows `ctx.notify` from a main plugin. Main sends a toast only to the
 * focused window; after a click on the OS notification it sends `open`.
 */
export const usePluginNotifications = () => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  useEffect(() => window.canvasWorkspace?.canvasPlugins?.onNotification?.((event) => {
    const { path } = event;
    if (event.open) {
      if (path) requestOpenPluginPage(path);
      return;
    }
    notify({
      tone: 'info',
      title: event.title,
      description: event.body,
      autoCloseMs: 0,
      ...(path ? { action: { label: t('pluginInstallCard.open'), onClick: () => requestOpenPluginPage(path) } } : {}),
    });
  }), [notify, t]);
};
