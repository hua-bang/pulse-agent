/**
 * Global AI Chat state, lifted to the App shell so a single conversation can
 * surface in two layouts that share one state:
 *   - dock  — narrow, resizable right-side panel available on ANY view
 *             (Canvas / Nodes / Graph / plugin pages)
 *   - page  — full-screen "focus mode" at the /chat route
 *
 * Both layouts are rendered by one always-mounted <ChatSurface>, so toggling
 * between them (or hiding the dock) never tears down the streaming/session
 * state. The provider owns:
 *   - the agent scope (global vs workspace) — the single source of truth both
 *     layouts read,
 *   - dock open/width + page rail collapse,
 *   - cross-scope session navigation (mirrors the old ChatPage handlers),
 *   - an "active context" registry: whichever view is on screen registers the
 *     nodes / selection / focus handler it wants the chat to act on,
 *   - add-to-chat plumbing (a registered insert-mention fn from the surface).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { AgentContextNodeRef, AgentScope, CanvasNode } from '../../types';
import type { UnifiedSession } from './ChatSessionsRail';

const WIDTH_STORAGE_KEY = 'canvas-workspace:chat-dock-width';
const DEFAULT_DOCK_WIDTH = 420;
const MIN_DOCK_WIDTH = 280;
const MAX_DOCK_WIDTH = 900;

const GLOBAL_SCOPE: AgentScope = { kind: 'global' };

export function scopeKeyOf(scope: AgentScope): string {
  return scope.kind === 'global' ? 'global' : `workspace:${scope.workspaceId}`;
}

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DOCK_WIDTH;
  return Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, value));
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_DOCK_WIDTH;
  try {
    const stored = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    if (!stored) return DEFAULT_DOCK_WIDTH;
    return clampWidth(Number(stored));
  } catch {
    return DEFAULT_DOCK_WIDTH;
  }
}

/**
 * Context contributed by the currently-visible view. The chat surface reads
 * this to know which nodes it can mention, what the user has selected, and how
 * to focus a node when a mention chip is clicked. `workspaceId` ties the
 * context to a scope: the surface only consumes nodes/selection when the
 * registered workspace matches the active chat scope, so a canvas selection
 * never leaks into an unrelated global/other-workspace conversation.
 */
export interface ChatActiveContext {
  source: 'canvas' | 'nodes' | 'graph' | 'plugin';
  workspaceId?: string;
  /** Full nodes, used for @-mentions (canvas only). */
  nodes?: CanvasNode[];
  rootFolder?: string;
  /** Full selected nodes (canvas) — drives the input context chips. */
  selectedNodes?: CanvasNode[];
  /** Pre-mapped selection refs (Nodes/Graph) — fed straight into requestContext. */
  selectedNodeRefs?: AgentContextNodeRef[];
  /** Focus a node from a mention chip. workspaceId defaults to the context's. */
  onNodeFocus?: (nodeId: string, workspaceId?: string) => void;
}

export interface OpenChatOptions {
  /** Bind the chat to this scope before opening (e.g. a node's workspace). */
  scope?: AgentScope;
  /** Pulse the input focus once the dock is open. */
  focusInput?: boolean;
}

interface ChatDockContextValue {
  // ── scope (single source of truth) ──────────────────────────
  agentScope: AgentScope;
  scopeKey: string;
  setAgentScope: (scope: AgentScope) => void;

  // ── dock ui ─────────────────────────────────────────────────
  dockOpen: boolean;
  openDock: (opts?: OpenChatOptions) => void;
  closeDock: () => void;
  toggleDock: (opts?: OpenChatOptions) => void;
  dockWidth: number;
  setDockWidth: (width: number) => void;
  railCollapsed: boolean;
  toggleRail: () => void;

  // ── sessions ────────────────────────────────────────────────
  pendingSessionId: string | null;
  newSessionRequest: number;
  selectSession: (session: UnifiedSession) => void;
  requestNewGlobalSession: () => void;
  consumeSession: () => void;

  // ── one-shot input focus request ────────────────────────────
  focusInputRequest: number;

  // ── active-view context registry ────────────────────────────
  activeContext: ChatActiveContext | null;
  setActiveContext: Dispatch<SetStateAction<ChatActiveContext | null>>;

  // ── add-to-chat (canvas mention insertion) ──────────────────
  registerInsertMention: (fn: (node: CanvasNode) => void) => () => void;
  addNodeToChat: (node: CanvasNode, workspaceId?: string) => void;
}

const ChatDockContext = createContext<ChatDockContextValue | null>(null);

export const ChatDockProvider = ({ children }: { children: ReactNode }) => {
  const [agentScope, setAgentScopeState] = useState<AgentScope>(GLOBAL_SCOPE);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockWidth, setDockWidthState] = useState<number>(() => readStoredWidth());
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [newSessionRequest, setNewSessionRequest] = useState(0);
  const [focusInputRequest, setFocusInputRequest] = useState(0);
  const [activeContext, setActiveContext] = useState<ChatActiveContext | null>(null);

  const scopeKey = scopeKeyOf(agentScope);
  const insertMentionRef = useRef<((node: CanvasNode) => void) | null>(null);

  const setAgentScope = useCallback((scope: AgentScope) => {
    setAgentScopeState((prev) => (scopeKeyOf(prev) === scopeKeyOf(scope) ? prev : scope));
  }, []);

  const setDockWidth = useCallback((width: number) => {
    const clamped = clampWidth(width);
    setDockWidthState(clamped);
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      /* localStorage may be unavailable; the width simply won't persist. */
    }
  }, []);

  const applyScope = useCallback((scope: AgentScope) => {
    setAgentScopeState((prev) => {
      if (scopeKeyOf(prev) === scopeKeyOf(scope)) return prev;
      // Switching scope starts a fresh conversation surface, so drop any
      // pending session-load targeted at the previous scope.
      setPendingSessionId(null);
      return scope;
    });
  }, []);

  const openDock = useCallback((opts?: OpenChatOptions) => {
    if (opts?.scope) applyScope(opts.scope);
    setDockOpen(true);
    if (opts?.focusInput) setFocusInputRequest((v) => v + 1);
  }, [applyScope]);

  const closeDock = useCallback(() => setDockOpen(false), []);

  const toggleDock = useCallback((opts?: OpenChatOptions) => {
    setDockOpen((prev) => {
      if (prev) return false;
      if (opts?.scope) applyScope(opts.scope);
      if (opts?.focusInput) setFocusInputRequest((v) => v + 1);
      return true;
    });
  }, [applyScope]);

  const toggleRail = useCallback(() => setRailCollapsed((v) => !v), []);

  // Mirror of the old ChatPage.handleSelectSession: same-scope click just
  // bumps the pending session; cross-scope click also switches scope.
  const selectSession = useCallback((session: UnifiedSession) => {
    const nextScope: AgentScope = session.workspaceId === '__global_chat__'
      ? GLOBAL_SCOPE
      : { kind: 'workspace', workspaceId: session.workspaceId };
    setAgentScopeState((prev) => (scopeKeyOf(prev) === scopeKeyOf(nextScope) ? prev : nextScope));
    setPendingSessionId(session.sessionId);
  }, []);

  const requestNewGlobalSession = useCallback(() => {
    setAgentScopeState(GLOBAL_SCOPE);
    setPendingSessionId(null);
    setNewSessionRequest((v) => v + 1);
  }, []);

  const consumeSession = useCallback(() => setPendingSessionId(null), []);

  const registerInsertMention = useCallback((fn: (node: CanvasNode) => void) => {
    insertMentionRef.current = fn;
    return () => {
      if (insertMentionRef.current === fn) insertMentionRef.current = null;
    };
  }, []);

  const addNodeToChat = useCallback((node: CanvasNode, workspaceId?: string) => {
    if (workspaceId) applyScope({ kind: 'workspace', workspaceId });
    setDockOpen(true);
    const tryInsert = () => {
      const fn = insertMentionRef.current;
      if (fn) {
        fn(node);
        return true;
      }
      return false;
    };
    // The surface may have just (re)mounted for a scope change, so its
    // insert-mention fn might not be registered yet — retry on next frame.
    if (!tryInsert()) {
      requestAnimationFrame(() => { tryInsert(); });
    }
  }, [applyScope]);

  const value = useMemo<ChatDockContextValue>(() => ({
    agentScope,
    scopeKey,
    setAgentScope,
    dockOpen,
    openDock,
    closeDock,
    toggleDock,
    dockWidth,
    setDockWidth,
    railCollapsed,
    toggleRail,
    pendingSessionId,
    newSessionRequest,
    selectSession,
    requestNewGlobalSession,
    consumeSession,
    focusInputRequest,
    activeContext,
    setActiveContext,
    registerInsertMention,
    addNodeToChat,
  }), [
    agentScope, scopeKey, setAgentScope, dockOpen, openDock, closeDock, toggleDock,
    dockWidth, setDockWidth, railCollapsed, toggleRail, pendingSessionId,
    newSessionRequest, selectSession, requestNewGlobalSession, consumeSession,
    focusInputRequest, activeContext, registerInsertMention, addNodeToChat,
  ]);

  return <ChatDockContext.Provider value={value}>{children}</ChatDockContext.Provider>;
};

export const useChatDock = (): ChatDockContextValue => {
  const ctx = useContext(ChatDockContext);
  if (!ctx) throw new Error('useChatDock must be used within <ChatDockProvider>');
  return ctx;
};

/**
 * Register the current view's chat context for as long as the calling
 * component is mounted, visible (`enabled`), and the inputs are stable. Views
 * call this so the dock knows what they're showing without prop-drilling
 * through App.
 *
 * `enabled` matters for keep-alive views (e.g. the canvas Workbench stays
 * mounted while you browse Nodes/Graph): passing `false` releases ownership so
 * the visible view's context wins instead of a hidden one's.
 */
export const useRegisterChatContext = (
  context: ChatActiveContext | null,
  enabled = true,
) => {
  const { setActiveContext } = useChatDock();
  const effective = enabled ? context : null;
  useEffect(() => {
    setActiveContext(effective);
    return () => {
      // Only clear if we're still the owner — a newly-mounted view may have
      // registered its own context during our teardown.
      setActiveContext((prev) => (prev === effective ? null : prev));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective]);
};
