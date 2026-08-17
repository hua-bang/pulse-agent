import type { ModelMessage } from 'ai';

import type { CanvasAgentMessage } from './types';
import { modelMessagesToToolCalls } from './engine-stream-callbacks';

interface MessageStore {
  addMessage(message: CanvasAgentMessage): void;
}

const messageText = (message: ModelMessage): string => {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => part && typeof part === 'object' && (part as { type?: string }).type === 'text'
      ? String((part as { text?: unknown }).text ?? '')
      : '')
    .join('');
};

const persistAssistantGroup = (
  store: MessageStore,
  messages: ModelMessage[],
  timestamp: number,
  runId?: string,
  metadata?: Pick<CanvasAgentMessage, 'turnStatus' | 'retryable'>,
): boolean => {
  const finalAssistant = [...messages].reverse().find(message => message.role === 'assistant');
  if (!finalAssistant) return false;
  const toolCalls = modelMessagesToToolCalls(messages);
  store.addMessage({
    role: 'assistant',
    content: messageText(finalAssistant) || '(no response)',
    timestamp,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    runId,
    ...metadata,
  });
  return true;
};

/** Persist the extra user/assistant turns emitted by native steer/follow-up. */
export function persistContinuedTurn(
  store: MessageStore,
  messages: ModelMessage[],
  options: {
    timestamp?: number;
    runId?: string;
    finalAssistant?: Pick<CanvasAgentMessage, 'turnStatus' | 'retryable'>;
  } = {},
): boolean {
  if (!messages.some(message => message.role === 'user')) return false;
  let timestamp = options.timestamp ?? Date.now();
  let group: ModelMessage[] = [];
  let firstAssistant = true;
  for (const message of messages) {
    if (message.role !== 'user') {
      group.push(message);
      continue;
    }
    if (persistAssistantGroup(store, group, timestamp, firstAssistant ? options.runId : undefined)) {
      timestamp += 1;
      firstAssistant = false;
    }
    store.addMessage({ role: 'user', content: messageText(message), timestamp });
    timestamp += 1;
    group = [];
  }
  const finalPersisted = persistAssistantGroup(
    store,
    group,
    timestamp,
    firstAssistant ? options.runId : undefined,
    options.finalAssistant,
  );
  if (!finalPersisted && options.finalAssistant) {
    store.addMessage({ role: 'assistant', content: '', timestamp, ...options.finalAssistant });
  }
  return true;
}

export function persistFailedContinuedTurn(
  store: MessageStore,
  messages: ModelMessage[],
  failure: CanvasAgentMessage,
): void {
  persistContinuedTurn(store, messages);
  store.addMessage(failure);
}
