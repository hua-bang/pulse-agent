import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useChatTargetBroker, waitForActiveChatTarget } from '../../modules/chat';
import {
  getRegisteredNavItems,
  getRegisteredRoutes,
  getRendererPluginRegistryVersion,
  setPluginChatTextHandler,
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
