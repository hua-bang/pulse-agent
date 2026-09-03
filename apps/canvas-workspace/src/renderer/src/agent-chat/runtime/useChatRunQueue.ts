import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentRequestContext, ChatRunInputMode } from '../../types';

export interface QueuedInput {
  id: number;
  mode: ChatRunInputMode;
  text: string;
  requestContext?: AgentRequestContext;
}

const queues = new Map<string, QueuedInput[]>();
const drainingScopes = new Set<string>();
let nextId = 0;

function enqueue(scopeKey: string, input: Omit<QueuedInput, 'id'>): void {
  const entry = { ...input, id: ++nextId };
  const current = queues.get(scopeKey) ?? [];
  const followUpIndex = current.findIndex(item => item.mode === 'follow-up');
  queues.set(scopeKey, input.mode === 'steer' && followUpIndex >= 0
    ? [...current.slice(0, followUpIndex), entry, ...current.slice(followUpIndex)]
    : [...current, entry]);
}

const clear = (scopeKey: string): void => { queues.delete(scopeKey); };
const conversationQueueKey = (scopeKey: string, sessionId: string | null | undefined): string =>
  `${scopeKey}\u0000${sessionId ?? ''}`;

export function useChatRunQueue(options: {
  scopeKey: string;
  loading: boolean;
  busyElsewhere: boolean;
  abort: () => Promise<boolean>;
  getConversationSessionId: () => string | null | undefined;
  sendMessage: (
    text: string,
    context?: AgentRequestContext,
  ) => Promise<'accepted' | 'blocked' | 'failed'>;
}) {
  const { abort, busyElsewhere, getConversationSessionId, loading, scopeKey, sendMessage } = options;
  const [revision, setRevision] = useState(0);
  const [steeringInputId, setSteeringInputId] = useState<number>();
  const retryRef = useRef<number>();
  const refresh = () => setRevision(value => value + 1);

  const submitRunInput = useCallback(async (
    mode: ChatRunInputMode,
    rawText: string,
    requestContext?: AgentRequestContext,
  ) => {
    const text = rawText.trim();
    if (!loading || !text) return false;
    if (mode === 'steer' && !(await abort())) return false;
    const sessionId = getConversationSessionId();
    enqueue(conversationQueueKey(scopeKey, sessionId), {
      mode,
      text,
      requestContext: {
        ...requestContext,
        expectedConversationSessionId: sessionId,
      },
    });
    refresh();
    return true;
  }, [abort, getConversationSessionId, loading, scopeKey]);

  const abortAndClearQueue = useCallback(async () => {
    clear(conversationQueueKey(scopeKey, getConversationSessionId()));
    refresh();
    return abort();
  }, [abort, getConversationSessionId, scopeKey]);

  const removeQueuedInput = useCallback((id: number) => {
    const queueKey = conversationQueueKey(scopeKey, getConversationSessionId());
    const rest = (queues.get(queueKey) ?? []).filter(input => input.id !== id);
    if (rest.length > 0) queues.set(queueKey, rest);
    else clear(queueKey);
    refresh();
  }, [getConversationSessionId, scopeKey]);

  const steerQueuedInput = useCallback(async (id: number) => {
    if (!loading) return false;
    const queueKey = conversationQueueKey(scopeKey, getConversationSessionId());
    const current = queues.get(queueKey) ?? [];
    const target = current.find(input => input.id === id);
    if (!target) return false;
    queues.set(queueKey, [
      { ...target, mode: 'steer' },
      ...current.filter(input => input.id !== id),
    ]);
    setSteeringInputId(id);
    refresh();
    const stopped = await abort();
    setSteeringInputId(undefined);
    if (!stopped) {
      queues.set(queueKey, current);
      refresh();
    }
    return stopped;
  }, [abort, getConversationSessionId, loading, scopeKey]);

  useEffect(() => {
    const queueKey = conversationQueueKey(scopeKey, getConversationSessionId());
    const next = queues.get(queueKey)?.[0];
    if (loading || busyElsewhere || !next || drainingScopes.has(queueKey)) return;
    drainingScopes.add(queueKey);
    let consumed = false;
    void sendMessage(next.text, next.requestContext).then((outcome) => {
      consumed = outcome !== 'blocked';
      if (consumed) {
        const rest = (queues.get(queueKey) ?? []).filter(input => input.id !== next.id);
        if (rest.length > 0) queues.set(queueKey, rest);
        else clear(queueKey);
      } else {
        retryRef.current = window.setTimeout(refresh, 120);
      }
    }).finally(() => {
      drainingScopes.delete(queueKey);
      if (consumed) refresh();
    });
  }, [busyElsewhere, getConversationSessionId, loading, revision, scopeKey, sendMessage]);

  useEffect(() => () => { if (retryRef.current) window.clearTimeout(retryRef.current); }, []);
  const queueKey = conversationQueueKey(scopeKey, getConversationSessionId());
  return {
    abortAndClearQueue,
    queuedInputs: queues.get(queueKey) ?? [],
    removeQueuedInput,
    steeringInputId,
    steerQueuedInput,
    submitRunInput,
  };
}
