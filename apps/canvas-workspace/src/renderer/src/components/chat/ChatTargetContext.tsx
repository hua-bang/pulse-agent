import {
  createContext,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type {
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
  AgentRequestContext,
  CanvasNode,
} from '../../types';
import type { AgentScope } from './types';

export type ChatTargetSurface = 'dock' | 'page';
export type ChatExecutionPolicy = 'auto' | 'ask' | 'scheduled';

export interface ChatContextSnapshot {
  /** Short user-facing description of the scope that supplied this context. */
  label: string;
  /** Labels shown in the scope bar; requestContext remains the send-time SSOT. */
  contextLabels?: string[];
  requestContext?: AgentRequestContext;
}

/**
 * Renderer-owned description of the composer a cross-surface action targets.
 * It deliberately contains no main/session protocol state.
 */
export interface ChatTarget {
  surface: ChatTargetSurface;
  scope: AgentScope;
  scopeId: string;
  sessionId: string | null;
  composerId: string;
  contextSnapshot: ChatContextSnapshot;
  executionPolicy: ChatExecutionPolicy;
}

export type ChatInsertion =
  | { kind: 'node'; node: CanvasNode; sourceWorkspaceId?: string }
  | { kind: 'dom-selection'; selection: AgentContextDomSelectionRef }
  | { kind: 'skill'; skillName: string }
  | { kind: 'dom-review'; comments: AgentContextDomReviewComment[] }
  | { kind: 'focus' };

export interface ChatTargetHandlers {
  insertNode?: (node: CanvasNode, sourceWorkspaceId?: string) => void;
  insertDomSelection?: (selection: AgentContextDomSelectionRef) => void;
  startSkillChat?: (skillName: string) => Promise<void>;
  submitDomReview?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  focus?: () => void;
}

export type ChatDeliveryReceipt =
  | { status: 'delivered'; target: ChatTarget }
  | { status: 'queued'; target: ChatTarget }
  | { status: 'unavailable'; target: ChatTarget | null }
  | { status: 'failed'; target: ChatTarget; error?: string };

export interface ChatTargetBroker {
  register: (target: ChatTarget, handlers: ChatTargetHandlers) => () => void;
  getActiveTarget: () => ChatTarget | null;
  subscribe: (listener: () => void) => () => void;
  deliver: (insertion: ChatInsertion) => Promise<ChatDeliveryReceipt>;
}

interface RegisteredTarget {
  target: ChatTarget;
  handlers: ChatTargetHandlers;
  order: number;
  token: symbol;
}

const targetPriority = (target: ChatTarget): number => (
  target.surface === 'page' ? 2 : 1
);

export const createChatTargetBroker = (): ChatTargetBroker => {
  const registrations = new Map<string, RegisteredTarget>();
  const listeners = new Set<() => void>();
  let registrationOrder = 0;
  let activeTarget: RegisteredTarget | null = null;

  const resolveActive = (): RegisteredTarget | null => {
    let next: RegisteredTarget | null = null;
    for (const registration of registrations.values()) {
      if (
        !next
        || targetPriority(registration.target) > targetPriority(next.target)
        || (
          targetPriority(registration.target) === targetPriority(next.target)
          && registration.order > next.order
        )
      ) {
        next = registration;
      }
    }
    return next;
  };

  const publish = () => {
    const next = resolveActive();
    if (next?.token === activeTarget?.token && next?.target === activeTarget?.target) return;
    activeTarget = next;
    for (const listener of listeners) listener();
  };

  const register: ChatTargetBroker['register'] = (target, handlers) => {
    const token = Symbol(target.composerId);
    registrations.set(target.composerId, {
      target,
      handlers,
      order: ++registrationOrder,
      token,
    });
    publish();
    return () => {
      if (registrations.get(target.composerId)?.token !== token) return;
      registrations.delete(target.composerId);
      publish();
    };
  };

  const deliver: ChatTargetBroker['deliver'] = async (insertion) => {
    const active = activeTarget;
    if (!active) return { status: 'unavailable', target: null };

    try {
      if (insertion.kind === 'node' && active.handlers.insertNode) {
        active.handlers.insertNode(insertion.node, insertion.sourceWorkspaceId);
      } else if (insertion.kind === 'dom-selection' && active.handlers.insertDomSelection) {
        active.handlers.insertDomSelection(insertion.selection);
      } else if (insertion.kind === 'skill' && active.handlers.startSkillChat) {
        await active.handlers.startSkillChat(insertion.skillName);
      } else if (insertion.kind === 'dom-review' && active.handlers.submitDomReview) {
        const submitted = await active.handlers.submitDomReview(insertion.comments);
        if (!submitted) return { status: 'failed', target: active.target };
      } else if (insertion.kind === 'focus' && active.handlers.focus) {
        active.handlers.focus();
      } else {
        return { status: 'unavailable', target: active.target };
      }
      return { status: 'delivered', target: active.target };
    } catch (error) {
      return {
        status: 'failed',
        target: active.target,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return {
    register,
    getActiveTarget: () => activeTarget?.target ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    deliver,
  };
};

const ChatTargetContext = createContext<ChatTargetBroker | null>(null);

export const ChatTargetProvider = ({ children }: { children: ReactNode }) => {
  const brokerRef = useRef<ChatTargetBroker>();
  if (!brokerRef.current) brokerRef.current = createChatTargetBroker();
  return (
    <ChatTargetContext.Provider value={brokerRef.current}>
      {children}
    </ChatTargetContext.Provider>
  );
};

export const useChatTargetBroker = (): ChatTargetBroker => {
  const broker = useContext(ChatTargetContext);
  if (!broker) throw new Error('useChatTargetBroker must be used within <ChatTargetProvider>');
  return broker;
};

export const useOptionalChatTargetBroker = (): ChatTargetBroker | null => (
  useContext(ChatTargetContext)
);

export const useActiveChatTarget = (): ChatTarget | null => {
  const broker = useChatTargetBroker();
  return useSyncExternalStore(
    broker.subscribe,
    broker.getActiveTarget,
    broker.getActiveTarget,
  );
};
