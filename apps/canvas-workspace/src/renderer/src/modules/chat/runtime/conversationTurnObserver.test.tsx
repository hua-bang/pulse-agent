// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationKey } from '../../../../../shared/conversation-runtime';
import { I18nProvider } from '../../../i18n';
import { useConversationRuntimeStream } from './useConversationRuntimeStream';
import {
  readConversationSnapshot,
  resetConversationStoreForTests,
  setConversationMessages,
} from './conversationStore';
import { resetConversationCompletionStoreForTests } from './conversationCompletionStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scope = { kind: 'workspace', workspaceId: 'ws-a' } as const;
const key = conversationKey(scope, 'session-a');

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: ReturnType<typeof useConversationRuntimeStream> | null = null;

function Harness() {
  latest = useConversationRuntimeStream({ agentScope: scope, conversationKey: key });
  return null;
}

function makeAgent(attach: (emit: (name: string, payload: unknown) => void) => Promise<unknown>) {
  const callbacks = new Map<string, (payload: any) => void>();
  const emit = (name: string, payload: unknown) => callbacks.get(name)?.(payload);
  const listen = (name: string) => (_sessionId: string, callback: (payload: any) => void) => {
    callbacks.set(name, callback);
    return () => { if (callbacks.get(name) === callback) callbacks.delete(name); };
  };
  return {
    emit,
    callbacks,
    agent: {
      onTextDelta: listen('text'),
      onToolCall: listen('tool-call'),
      onToolResult: listen('tool-result'),
      onToolInputStart: listen('tool-input-start'),
      onToolInputDelta: listen('tool-input-delta'),
      onToolInputEnd: listen('tool-input-end'),
      onClarifyRequest: listen('clarify'),
      onChatComplete: listen('complete'),
      onRoleTurnStart: listen('role-start'),
      onRoleTurnEnd: listen('role-end'),
      conversationAttach: vi.fn(() => attach(emit)),
    },
  };
}

async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(I18nProvider, null, createElement(Harness)));
  });
}

beforeEach(() => {
  resetConversationStoreForTests();
  resetConversationCompletionStoreForTests();
  latest = null;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  resetConversationStoreForTests();
  resetConversationCompletionStoreForTests();
});

describe('conversation turn reattach', () => {
  it('resumes a running turn from main after the renderer lost its stream', async () => {
    const persisted = [{ role: 'user' as const, content: 'hello', timestamp: 1 }];
    setConversationMessages(key, persisted);
    const { agent, emit } = makeAgent(async (emitEvent) => {
      // Sent before main took the snapshot: already part of the draft.
      emitEvent('text', 'Par');
      return {
        ok: true,
        running: true,
        snapshot: {
          key,
          status: 'running',
          messages: persisted,
          draft: { role: 'assistant', content: 'Par', contentBlocks: [{ type: 'text', text: 'Par' }], timestamp: 2 },
          streamingTools: [],
          clarification: null,
          error: null,
          runId: null,
          sequence: 7,
        },
      };
    });
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = { agent };

    await mount();

    expect(agent.conversationAttach).toHaveBeenCalledWith(scope, 'session-a');
    expect(latest?.loading).toBe(true);
    expect(readConversationSnapshot(key).messages.at(-1)?.content).toBe('Par');

    await act(async () => {
      emit('text', 'tial');
      await new Promise(resolve => setTimeout(resolve, 50));
      emit('complete', { ok: true, response: 'Partial' });
    });

    expect(latest?.loading).toBe(false);
    expect(readConversationSnapshot(key).messages.map(message => message.content)).toEqual(['hello', 'Partial']);
  });

  it('releases its listeners when main has no running turn', async () => {
    setConversationMessages(key, [{ role: 'user', content: 'hello', timestamp: 1 }]);
    const { agent, callbacks } = makeAgent(async () => ({ ok: true, running: false }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = { agent };

    await mount();

    expect(agent.conversationAttach).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(0);
    expect(latest?.loading).toBe(false);
  });
});
