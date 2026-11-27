import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEventHandler } from 'react';
import type {
  RemoteVpsChatRoomActiveTurn,
  RemoteVpsChatRoomQueuedItem,
} from '../../../../../../../shared/api/remote-vps';
import type { AgentChatMessage, ToolCallStatus } from '../../../../../types';
import { useAppShell } from '../../../../../shared/appShell';
import { setSelfSenderName } from '../../../../../shared/remotePresence';
import { useI18n } from '../../../../../i18n';
import { isImeComposing } from '../../../../../utils/ime';

interface UseSharedChatRoomOptions {
  workspaceId: string;
  conversationId: string;
  messages: readonly AgentChatMessage[];
  streamingTools?: readonly ToolCallStatus[];
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
  chatRoomActive: boolean;
  activeTurn: RemoteVpsChatRoomActiveTurn | null;
  queue: RemoteVpsChatRoomQueuedItem[];
  typingPeers: string[];
  noteOnly: boolean;
  toggleNoteOnly: () => void;
  displayMessages: AgentChatMessage[];
  cancelQueued: (itemId: string) => void;
  onSubmit: () => Promise<boolean>;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
}

function findRunningToolName(tools?: readonly ToolCallStatus[]): string | undefined {
  if (!tools || tools.length === 0) return undefined;
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    if (tools[i].status === 'running' && tools[i].name) return tools[i].name;
  }
  return undefined;
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
  streamingTools,
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
  const [typingPeers, setTypingPeers] = useState<string[]>([]);
  const [noteOnly, setNoteOnly] = useState(false);

  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const reloadSessionRef = useRef(reloadSession);
  reloadSessionRef.current = reloadSession;
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const claimingRef = useRef(false);
  const heldTurnRef = useRef(false);
  const claimedConvIdRef = useRef<string | null>(null);

  const lastAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
    ? messages[messages.length - 1].content
    : '';
  const latestTextRef = useRef(lastAssistant);
  latestTextRef.current = lastAssistant;
  const latestToolRef = useRef<string | undefined>(undefined);
  latestToolRef.current = findRunningToolName(streamingTools);

  // Detect whether this workspace is backed by a remote VPS. Local canvases stay false (no-op).
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api?.getConfig || !workspaceId) {
      setIsRemote((prev) => (prev ? false : prev));
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
          claimedConvIdRef.current = conversationId;
          if (res.activeTurn !== undefined) setActiveTurn(res.activeTurn);
          if (res.queue) setQueue(res.queue);
          void sendMessageRef.current(res.nextItem.message);
        }).catch(() => {
          claimingRef.current = false;
        });
      }, 250);
    },
    [conversationId, workspaceId],
  );

  // Subscribe to VPS chat-room SSE stream and load initial room state.
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!isRemote || !workspaceId || !conversationId || !api?.subscribeChatRoom || !api?.onChatRoomEvent) {
      setActiveTurn((prev) => (prev === null ? prev : null));
      setQueue((prev) => (prev.length === 0 ? prev : []));
      setTypingPeers((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    setSupported(true);

    void api.subscribeChatRoom(workspaceId);
    void api.getChatRoomState?.(workspaceId, conversationId).then((res) => {
      if (cancelled || !res) return;
      if (res.selfName) setSelfSenderName(workspaceId, res.selfName);
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
      // Match exact conversationId, or accept any workspace turn when this client is on an empty
      // "New AI chat" screen (`conversationId === workspaceId`) so peers see live host streaming.
      if (event.workspaceId !== workspaceId) return;
      if (event.conversationId !== conversationId && conversationId !== workspaceId) return;
      setActiveTurn(event.activeTurn);
      setQueue(event.queue);
      if (event.typingPeers !== undefined) setTypingPeers(event.typingPeers);
      if (event.turnEnded) {
        if (!event.endedBySelf && !loadingRef.current) reloadSessionRef.current();
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
  }, [conversationId, isRemote, tryClaimNext, workspaceId]);

  // Throttled typing indicator while drafting a message on a shared workspace.
  const lastTypingPingRef = useRef(0);
  const wasTypingRef = useRef(false);
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!isRemote || !supported || !workspaceId || !conversationId || !api?.setChatRoomTyping) return;
    const active = Boolean(input.trim());
    if (!active) {
      if (wasTypingRef.current) {
        wasTypingRef.current = false;
        void api.setChatRoomTyping(workspaceId, conversationId, false).catch(() => undefined);
      }
      return;
    }
    const now = Date.now();
    if (!wasTypingRef.current || now - lastTypingPingRef.current >= 2_000) {
      wasTypingRef.current = true;
      lastTypingPingRef.current = now;
      void api.setChatRoomTyping(workspaceId, conversationId, true).catch(() => undefined);
    }
    const idleTimer = window.setTimeout(() => {
      if (wasTypingRef.current) {
        wasTypingRef.current = false;
        void api.setChatRoomTyping?.(workspaceId, conversationId, false).catch(() => undefined);
      }
    }, 3_200);
    return () => window.clearTimeout(idleTimer);
  }, [conversationId, input, isRemote, supported, workspaceId]);

  // Outbound ~150ms streaming frames while this client is running + release on completion/unmount.
  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!isRemote || !supported || !workspaceId || !conversationId || !api?.streamChatRoom) return;

    if (!loading) {
      if (heldTurnRef.current) {
        const releaseConvId = claimedConvIdRef.current ?? conversationId;
        heldTurnRef.current = false;
        claimedConvIdRef.current = null;
        void api.releaseChatRoom?.(workspaceId, releaseConvId).catch(() => undefined);
      }
      return;
    }

    // If a new sessionId was created mid-turn (workspaceId -> sessionId), release the placeholder lease.
    if (claimedConvIdRef.current && claimedConvIdRef.current !== conversationId) {
      const prevConvId = claimedConvIdRef.current;
      void api.releaseChatRoom?.(workspaceId, prevConvId).catch(() => undefined);
    }
    heldTurnRef.current = true;
    claimedConvIdRef.current = conversationId;
    let lastSent = '';
    let lastTool: string | undefined;
    let lastPushAt = 0;

    const push = (force = false) => {
      const preview = latestTextRef.current.slice(-4000);
      const toolName = latestToolRef.current;
      const now = Date.now();
      if (!force && preview === lastSent && toolName === lastTool && now - lastPushAt < 8_000) return;
      lastSent = preview;
      lastTool = toolName;
      lastPushAt = now;
      void api.streamChatRoom?.(workspaceId, conversationId, preview, toolName).catch(() => undefined);
    };

    push(true);
    const timer = window.setInterval(() => push(false), 150);
    return () => {
      window.clearInterval(timer);
    };
  }, [conversationId, isRemote, loading, supported, workspaceId]);

  const toggleNoteOnly = useCallback(() => {
    setNoteOnly((prev) => !prev);
  }, []);

  const wrappedOnSubmit = useCallback(async () => {
    const api = window.canvasWorkspace?.remoteVps;
    const trimmed = input.trim();
    if (!isRemote || !supported || !workspaceId || !conversationId || !trimmed) {
      return await onSubmit();
    }
    if (wasTypingRef.current) {
      wasTypingRef.current = false;
      void api?.setChatRoomTyping?.(workspaceId, conversationId, false).catch(() => undefined);
    }
    if (noteOnly && api?.sendChatRoomNote) {
      const res = await api.sendChatRoomNote(workspaceId, conversationId, trimmed);
      if (res.forbidden) {
        notify({ tone: 'info', title: t('chatRoom.viewerReadOnly'), autoCloseMs: 2600 });
        return false;
      }
      if (res.ok) {
        clearInput();
        reloadSessionRef.current();
        return true;
      }
      return false;
    }
    if (!api?.enqueueChatRoom || loading) {
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
      claimedConvIdRef.current = conversationId;
      try {
        const ok = await onSubmit();
        if (!ok && !loadingRef.current) {
          heldTurnRef.current = false;
          claimedConvIdRef.current = null;
          void api.releaseChatRoom?.(workspaceId, conversationId).catch(() => undefined);
        }
        return ok;
      } catch (error) {
        if (!loadingRef.current) {
          heldTurnRef.current = false;
          claimedConvIdRef.current = null;
          void api.releaseChatRoom?.(workspaceId, conversationId).catch(() => undefined);
        }
        throw error;
      }
    }
    clearInput();
    return true;
  }, [clearInput, conversationId, input, isRemote, loading, noteOnly, notify, onSubmit, supported, t, workspaceId]);

  const wrappedOnKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>(
    (event) => {
      if (
        isRemote
        && supported
        && workspaceId
        && conversationId
        && (noteOnly || !loading)
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
    [conversationId, input, isRemote, loading, mentionOpen, noteOnly, onKeyDown, supported, workspaceId, wrappedOnSubmit],
  );

  const cancelQueued = useCallback(
    (itemId: string) => {
      const api = window.canvasWorkspace?.remoteVps;
      if (!api?.cancelChatRoomQueued || !workspaceId || !conversationId) return;
      void api.cancelChatRoomQueued(workspaceId, conversationId, itemId).catch(() => undefined);
    },
    [conversationId, workspaceId],
  );

  const displayMessages = useMemo<AgentChatMessage[]>(() => {
    if (!isRemote) return messages as AgentChatMessage[];
    // Never overlay a peer streaming bubble while this client is already streaming locally.
    const hasPeerTurn = Boolean(!loading && activeTurn && !activeTurn.self);
    if (!hasPeerTurn && queue.length === 0) {
      return messages as AgentChatMessage[];
    }
    const next = [...messages];
    if (hasPeerTurn && activeTurn) {
      const last = next[next.length - 1];
      const prev = next.length >= 2 ? next[next.length - 2] : undefined;
      const peerAssistant: AgentChatMessage = {
        role: 'assistant',
        content: activeTurn.text || (activeTurn.toolName ? '' : '…'),
        ...(activeTurn.toolName
          ? { toolCalls: [{ id: 1, name: activeTurn.toolName, status: 'running' as const }] }
          : {}),
        timestamp: activeTurn.updatedAt,
      };
      if (
        last?.role === 'assistant'
        && activeTurn.prompt
        && prev?.role === 'user'
        && prev.content === activeTurn.prompt
      ) {
        next[next.length - 1] = peerAssistant;
      } else {
        if (activeTurn.prompt && !(last?.role === 'user' && last.content === activeTurn.prompt)) {
          next.push({
            role: 'user',
            senderName: activeTurn.senderName,
            content: activeTurn.prompt,
            timestamp: activeTurn.startedAt,
          });
        }
        next.push(peerAssistant);
      }
    }
    for (const item of queue) {
      const alreadyLast = next[next.length - 1];
      if (alreadyLast?.role === 'user' && alreadyLast.content === item.message) continue;
      next.push({
        role: 'user',
        senderName: item.senderName,
        content: item.message,
        timestamp: item.createdAt,
      });
    }
    return next;
  }, [activeTurn, isRemote, loading, messages, queue]);

  if (!isRemote) {
    return {
      chatRoomActive: false,
      activeTurn: null,
      queue: [],
      typingPeers: [],
      noteOnly: false,
      toggleNoteOnly,
      displayMessages: messages as AgentChatMessage[],
      cancelQueued,
      onSubmit,
      onKeyDown,
    };
  }

  return {
    chatRoomActive: supported,
    activeTurn,
    queue,
    typingPeers,
    noteOnly,
    toggleNoteOnly,
    displayMessages,
    cancelQueued,
    onSubmit: wrappedOnSubmit,
    onKeyDown: wrappedOnKeyDown,
  };
}
