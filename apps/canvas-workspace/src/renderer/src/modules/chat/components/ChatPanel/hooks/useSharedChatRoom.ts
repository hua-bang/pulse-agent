import { useCallback, useEffect, useRef, useState, type KeyboardEventHandler } from 'react';
import type {
  RemoteVpsChatRoomActiveTurn,
  RemoteVpsChatRoomQueuedItem,
} from '../../../../../../../shared/api/remote-vps';
import type { AgentChatMessage } from '../../../../../types';
import { useAppShell } from '../../../../../shared/appShell';
import { useI18n } from '../../../../../i18n';
import { isImeComposing } from '../../../../../utils/ime';

interface UseSharedChatRoomOptions {
  workspaceId: string;
  conversationId: string;
  messages: readonly AgentChatMessage[];
  loading: boolean;
  input: string;
  mentionOpen: boolean;
  onSubmit: () => Promise<boolean>;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  sendMessage: (message: string) => Promise<boolean> | boolean | void;
  clearInput: () => void;
  reloadSession: () => void;
}

export interface SharedChatRoomState {
  activeTurn: RemoteVpsChatRoomActiveTurn | null;
  queue: RemoteVpsChatRoomQueuedItem[];
  cancelQueued: (itemId: string) => void;
  onSubmit: () => Promise<boolean>;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
}

/**
 * Coordinates multi-human x single-agent turns on shared remote VPS workspaces.
 * For local (non-remote) canvases this hook is a complete no-op and returns
 * the original `onSubmit` and `onKeyDown` handlers untouched.
 */
export function useSharedChatRoom({
  workspaceId,
  conversationId,
  messages,
  loading,
  input,
  mentionOpen,
  onSubmit,
  onKeyDown,
  sendMessage,
  clearInput,
  reloadSession,
}: UseSharedChatRoomOptions): SharedChatRoomState {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const [isRemote, setIsRemote] = useState(false);
  const [supported, setSupported] = useState(true);
  const [activeTurn, setActiveTurn] = useState<RemoteVpsChatRoomActiveTurn | null>(null);
  const [queue, setQueue] = useState<RemoteVpsChatRoomQueuedItem[]>([]);

  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const claimingRef = useRef(false);
  const heldTurnRef = useRef(false);

  const lastAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
    ? messages[messages.length - 1].content
    : '';
  const latestTextRef = useRef(lastAssistant);
  latestTextRef.current = lastAssistant;

  // Detect whether this workspace is backed by a remote VPS. Local canvases stay false (no-op).
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api?.getConfig || !workspaceId) {
      setIsRemote(false);
      return;
    }
    let cancelled = false;
    void api.getConfig(workspaceId).then((res) => {
      if (!cancelled) setIsRemote(Boolean(res.ok && res.config));
    }).catch(() => {
      if (!cancelled) setIsRemote(false);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const tryClaimNext = useCallback(
    (nextQueue: RemoteVpsChatRoomQueuedItem[]) => {
      const api = window.canvasWorkspace?.remoteVps;
      if (!api?.claimChatRoom || !workspaceId || !conversationId) return;
      if (claimingRef.current || loadingRef.current) return;
      if (!nextQueue[0]?.self) return;
      claimingRef.current = true;
      window.setTimeout(() => {
        void api.claimChatRoom?.(workspaceId, conversationId, { popNext: true }).then((res) => {
          claimingRef.current = false;
          if (!res?.ok || !res.claimed || !res.nextItem) return;
          heldTurnRef.current = true;
          if (res.activeTurn !== undefined) setActiveTurn(res.activeTurn);
          if (res.queue) setQueue(res.queue);
          void sendMessage(res.nextItem.message);
        }).catch(() => {
          claimingRef.current = false;
        });
      }, 250);
    },
    [conversationId, sendMessage, workspaceId],
  );

  // Subscribe to VPS chat-room SSE stream and load initial room state.
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!isRemote || !workspaceId || !conversationId || !api?.subscribeChatRoom || !api?.onChatRoomEvent) {
      setActiveTurn(null);
      setQueue([]);
      return;
    }
    let cancelled = false;
    setSupported(true);

    void api.subscribeChatRoom(workspaceId);
    void api.getChatRoomState?.(workspaceId, conversationId).then((res) => {
      if (cancelled || !res) return;
      if (res.fallback) {
        setSupported(false);
        return;
      }
      if (res.ok) {
        setActiveTurn(res.activeTurn);
        setQueue(res.queue);
      }
    }).catch(() => undefined);

    const unsubscribe = api.onChatRoomEvent((event) => {
      if (cancelled) return;
      if (event.workspaceId !== workspaceId || event.conversationId !== conversationId) return;
      setActiveTurn(event.activeTurn);
      setQueue(event.queue);
      if (event.turnEnded) {
        if (!loadingRef.current) reloadSession();
        if (!event.activeTurn && event.queue[0]?.self) {
          tryClaimNext(event.queue);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      void api.unsubscribeChatRoom?.(workspaceId);
    };
  }, [conversationId, isRemote, reloadSession, tryClaimNext, workspaceId]);

  // Outbound ~150ms streaming frames while this client is running + release on completion.
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!isRemote || !supported || !workspaceId || !conversationId || !api?.streamChatRoom) return;

    if (!loading) {
      if (heldTurnRef.current) {
        heldTurnRef.current = false;
        void api.releaseChatRoom?.(workspaceId, conversationId).catch(() => undefined);
      }
      return;
    }

    heldTurnRef.current = true;
    let lastSent = '';
    let lastPushAt = 0;

    const push = (force = false) => {
      const preview = latestTextRef.current.slice(-4000);
      const now = Date.now();
      if (!force && preview === lastSent && now - lastPushAt < 8_000) return;
      lastSent = preview;
      lastPushAt = now;
      void api.streamChatRoom?.(workspaceId, conversationId, preview).catch(() => undefined);
    };

    push(true);
    const timer = window.setInterval(() => push(false), 150);
    return () => {
      window.clearInterval(timer);
    };
  }, [conversationId, isRemote, loading, supported, workspaceId]);

  const wrappedOnSubmit = useCallback(async () => {
    const api = window.canvasWorkspace?.remoteVps;
    const trimmed = input.trim();
    if (!isRemote || !supported || !workspaceId || !conversationId || !api?.enqueueChatRoom || !trimmed || loading) {
      return await onSubmit();
    }
    const res = await api.enqueueChatRoom(workspaceId, conversationId, trimmed);
    if (res.fallback) {
      return await onSubmit();
    }
    if (res.forbidden) {
      notify({ tone: 'info', title: t('chatRoom.viewerReadOnly'), autoCloseMs: 2600 });
      return false;
    }
    if (res.activeTurn !== undefined) setActiveTurn(res.activeTurn);
    if (res.queue) setQueue(res.queue);
    if (res.claimed) {
      heldTurnRef.current = true;
      return await onSubmit();
    }
    clearInput();
    return true;
  }, [clearInput, conversationId, input, isRemote, loading, notify, onSubmit, supported, t, workspaceId]);

  const wrappedOnKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>(
    (event) => {
      if (
        isRemote
        && supported
        && workspaceId
        && conversationId
        && !loading
        && !mentionOpen
        && input.trim()
        && event.key === 'Enter'
        && !event.shiftKey
        && !isImeComposing(event)
      ) {
        event.preventDefault();
        void wrappedOnSubmit();
        return;
      }
      onKeyDown(event);
    },
    [conversationId, input, isRemote, loading, mentionOpen, onKeyDown, supported, workspaceId, wrappedOnSubmit],
  );

  const cancelQueued = useCallback(
    (itemId: string) => {
      const api = window.canvasWorkspace?.remoteVps;
      if (!api?.cancelChatRoomQueued || !workspaceId || !conversationId) return;
      void api.cancelChatRoomQueued(workspaceId, conversationId, itemId).catch(() => undefined);
    },
    [conversationId, workspaceId],
  );

  if (!isRemote) {
    return {
      activeTurn: null,
      queue: [],
      cancelQueued,
      onSubmit,
      onKeyDown,
    };
  }

  return {
    activeTurn,
    queue,
    cancelQueued,
    onSubmit: wrappedOnSubmit,
    onKeyDown: wrappedOnKeyDown,
  };
}
