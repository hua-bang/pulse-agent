import {
  createContext,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type {
  ChatInsertion,
  ChatTarget,
  ChatTargetBroker,
  ChatTargetHandlers,
} from '../../../shared/chatTarget';
export type * from '../../../shared/chatTarget';

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
  const pendingContextInsertions = new Map<string, ChatInsertion[]>();
  const listeners = new Set<() => void>();
  let registrationOrder = 0;
  let activeTarget: RegisteredTarget | null = null;

  const tryInsertContext = (
    registration: RegisteredTarget,
    insertion: ChatInsertion,
  ): boolean => {
    if (insertion.kind === 'node' && registration.handlers.insertNode) {
      registration.handlers.insertNode(insertion.node, insertion.sourceWorkspaceId);
      return true;
    }
    if (insertion.kind === 'dom-selection' && registration.handlers.insertDomSelection) {
      registration.handlers.insertDomSelection(insertion.selection);
      return true;
    }
    if (insertion.kind === 'tab' && registration.handlers.insertTab) {
      registration.handlers.insertTab(insertion.tab);
      return true;
    }
    return false;
  };

  const queueContextInsertion = (composerId: string, insertion: ChatInsertion) => {
    const pending = pendingContextInsertions.get(composerId) ?? [];
    pendingContextInsertions.set(composerId, [...pending.slice(-31), insertion]);
  };

  const drainContextInsertions = (registration: RegisteredTarget) => {
    const pending = pendingContextInsertions.get(registration.target.composerId);
    if (!pending?.length) return;
    const remaining: ChatInsertion[] = [];
    for (const insertion of pending) {
      try {
        if (!tryInsertContext(registration, insertion)) remaining.push(insertion);
      } catch {
        remaining.push(insertion);
      }
    }
    if (remaining.length > 0) {
      pendingContextInsertions.set(registration.target.composerId, remaining);
    } else {
      pendingContextInsertions.delete(registration.target.composerId);
    }
  };

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
    const registration: RegisteredTarget = {
      target,
      handlers,
      order: ++registrationOrder,
      token,
    };
    registrations.set(target.composerId, registration);
    publish();
    drainContextInsertions(registration);
    return () => {
      if (registrations.get(target.composerId)?.token !== token) return;
      registrations.delete(target.composerId);
      publish();
      queueMicrotask(() => {
        if (!registrations.has(target.composerId)) {
          pendingContextInsertions.delete(target.composerId);
        }
      });
    };
  };

  const deliver: ChatTargetBroker['deliver'] = async (insertion) => {
    const active = activeTarget;
    if (!active) return { status: 'unavailable', target: null };

    try {
      if (
        insertion.kind === 'node'
        || insertion.kind === 'dom-selection'
        || insertion.kind === 'tab'
      ) {
        if (tryInsertContext(active, insertion)) {
          return { status: 'delivered', target: active.target };
        }
        queueContextInsertion(active.target.composerId, insertion);
        return { status: 'queued', target: active.target };
      }
      if (insertion.kind === 'skill' && active.handlers.startSkillChat) {
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
