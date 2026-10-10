import { useCallback, useEffect, useRef, useState } from 'react';
import { useOptionalChatTargetBroker, type ChatTargetBroker } from '../../../../chat';
import { useChatDeliveryNotifier } from '../../../../chat/delivery';
import { CHAT_TAB_ID, type DockStore } from '../state/dock-store';

/** Wait only for the requested scope. A late registration after navigation
 * must never receive a file intended for the previous workspace. */
const waitForTarget = (broker: ChatTargetBroker, scopeId: string, signal: AbortSignal): Promise<boolean> => (
  new Promise(resolve => {
    let unsubscribe = () => {};
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', abort);
      resolve(ready);
    };
    const abort = () => finish(false);
    const check = () => { if (broker.getActiveTarget()?.scopeId === scopeId) finish(true); };
    const timer = setTimeout(() => finish(false), 5000);
    unsubscribe = broker.subscribe(check);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else check();
  })
);

export const useFileChatAction = (store: DockStore, tabId: string) => {
  const broker = useOptionalChatTargetBroker();
  const notifyDelivery = useChatDeliveryNotifier();
  const [adding, setAdding] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const scopeId = store.getSnapshot().activeTerminalWorkspaceId;
  useEffect(() => {
    setAdding(false);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [scopeId]);
  const showChat = useCallback(() => {
    if (!store.getSnapshot().splitTabIds) { store.activate(tabId); store.toggleSplitView(); }
    store.activate(CHAT_TAB_ID);
  }, [store, tabId]);
  const addToChat = useCallback(async (filePath: string, isDirectory = false) => {
    if (!broker || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setAdding(true);
    try {
      if (!broker.getActiveTarget()) {
        showChat();
        const ready = await waitForTarget(broker, scopeId, controller.signal);
        if (controller.signal.aborted) return;
        if (!ready) { notifyDelivery({ status: 'unavailable', target: null }, filePath); return; }
      }
      if (store.getSnapshot().activeTerminalWorkspaceId !== scopeId) return;
      const receipt = await broker.deliver({ kind: 'file', filePath, ...(isDirectory ? { isDirectory: true } : {}) });
      if (controller.signal.aborted || store.getSnapshot().activeTerminalWorkspaceId !== scopeId) return;
      notifyDelivery(receipt, filePath.split(/[\\/]/).pop());
      if ((receipt.status === 'delivered' || receipt.status === 'queued') && receipt.target.surface === 'dock') showChat();
    } finally {
      if (pending.current === controller) { pending.current = null; setAdding(false); }
    }
  }, [broker, notifyDelivery, scopeId, showChat, store]);
  return { addToChat, adding, available: Boolean(broker) };
};
