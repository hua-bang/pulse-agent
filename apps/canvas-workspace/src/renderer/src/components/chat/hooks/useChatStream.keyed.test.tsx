// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { conversationKey, type ConversationKey } from '../../../../../shared/conversation-runtime';
import { useConversationRuntimeStream } from './useConversationRuntimeStream';
import { I18nProvider } from '../../../i18n';
import {
  readConversationSnapshot,
  resetConversationStoreForTests,
  setConversationClarification,
  setConversationLoading,
  setConversationMessages,
} from './conversationStore';
import {
  readConversationCompletions,
  resetConversationCompletionStoreForTests,
} from './conversationCompletionStore';

const scope = { kind: 'workspace', workspaceId: 'ws-a' } as const;
const keyA: ConversationKey = conversationKey(scope, 'session-a');
const keyB: ConversationKey = conversationKey(scope, 'session-b');

let host: HTMLDivElement | null;
let root: Root | null = null;
let latest: ReturnType<typeof useConversationRuntimeStream> | null = null;

function Harness({ conversationKey: key }: { conversationKey?: ConversationKey }) {
  if (!key) return null;
  latest = useConversationRuntimeStream({ agentScope: scope, conversationKey: key });
  return null;
}

function mount(key?: ConversationKey): void {
  if (!host) throw new Error('host not initialized');
  const nextRoot = createRoot(host);
  root = nextRoot;
  act(() => {
    nextRoot.render(createElement(I18nProvider, null, createElement(Harness, { conversationKey: key })));
  });
}

function rerender(key?: ConversationKey): void {
  const activeRoot = root;
  if (!activeRoot) throw new Error('root not mounted');
  act(() => {
    activeRoot.render(createElement(I18nProvider, null, createElement(Harness, { conversationKey: key })));
  });
}

beforeEach(() => {
  resetConversationStoreForTests();
  resetConversationCompletionStoreForTests();
  host = document.createElement('div');
  document.body.appendChild(host);
  latest = null;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  resetConversationStoreForTests();
  resetConversationCompletionStoreForTests();
  vi.restoreAllMocks();
});

describe('useConversationRuntimeStream (keyed mode)', () => {
  it('renders the store snapshot for the selected conversation (switch = selector)', () => {
    // A sibling surface wrote to conversation A's store.
    setConversationMessages(keyA, [{ role: 'user', content: 'A-message', timestamp: 0 }]);

    mount(keyA);
    expect(latest?.messages.map(m => m.content)).toEqual(['A-message']);

    // Switching to B (empty store) shows B's empty thread, not A's.
    rerender(keyB);
    expect(latest?.messages).toEqual([]);
  });

  it('keeps per-conversation state across switches without replay', () => {
    setConversationMessages(keyA, [{ role: 'user', content: 'A', timestamp: 0 }]);
    setConversationMessages(keyB, [{ role: 'user', content: 'B', timestamp: 0 }]);

    mount(keyA);
    expect(latest?.messages.map(m => m.content)).toEqual(['A']);

    rerender(keyB);
    expect(latest?.messages.map(m => m.content)).toEqual(['B']);

    // Switch back to A — same snapshot, no replay/rebuild needed.
    rerender(keyA);
    expect(latest?.messages.map(m => m.content)).toEqual(['A']);
  });

  it('surfaces per-conversation loading/clarification from the store', () => {
    setConversationMessages(keyA, [{ role: 'user', content: 'A', timestamp: 0 }]);
    setConversationMessages(keyB, [{ role: 'user', content: 'B', timestamp: 0 }]);
    setConversationLoading(keyA, true);
    setConversationClarification(keyA, { id: 'clar-1', question: 'confirm?' });

    mount(keyA);
    expect(latest?.loading).toBe(true);
    expect(latest?.pendingClarify?.id).toBe('clar-1');

    rerender(keyB);
    expect(latest?.loading).toBe(false);
    expect(latest?.pendingClarify).toBeNull();
  });

  it('releases every run listener after a completed turn', async () => {
    const callbacks = new Map<string, (payload: any) => void>();
    const unsubs: Array<ReturnType<typeof vi.fn>> = [];
    const listen = (name: string) => (_sessionId: string, callback: (payload: any) => void) => {
      callbacks.set(name, callback);
      const unsubscribe = vi.fn();
      unsubs.push(unsubscribe);
      return unsubscribe;
    };
    const agent = {
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
      conversationChat: vi.fn(async () => {
        callbacks.get('complete')?.({ ok: true, response: 'done without a delta' });
        return { ok: true, sessionId: keyA.sessionId };
      }),
    };
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = { agent };
    mount(keyA);

    await act(async () => {
      expect(await latest?.sendMessage('hello')).toBe(true);
    });

    expect(unsubs).toHaveLength(10);
    expect(unsubs.every(unsubscribe => unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(readConversationSnapshot(keyA).messages.at(-1)?.content)
      .toBe('done without a delta');
    expect(readConversationCompletions()[0]).toMatchObject({ key: keyA, status: 'done' });
  });

  it('tracks relay progress when a handoff expands the queue mid-turn', async () => {
    const callbacks = new Map<string, (payload: any) => void>();
    const listen = (name: string) => (_sessionId: string, callback: (payload: any) => void) => {
      callbacks.set(name, callback);
      return () => undefined;
    };
    const agent = {
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
      conversationChat: vi.fn(async () => ({ ok: true, sessionId: keyA.sessionId })),
    };
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = { agent };
    mount(keyA);

    await act(async () => {
      expect(await latest?.sendMessage('review this')).toBe(true);
    });

    const reviewer = { id: 'reviewer', name: 'Reviewer', color: '#d9730d' };
    const architect = { id: 'architect', name: 'Architect', color: '#2383e2', namedBy: 'Reviewer' };
    act(() => callbacks.get('role-start')?.({ index: 0, total: 1, queue: [reviewer] }));
    expect(latest?.relay).toMatchObject({ speaking: 0, total: 1 });

    act(() => callbacks.get('role-end')?.({ index: 0, total: 2 }));
    act(() => callbacks.get('role-start')?.({ index: 1, total: 2, queue: [reviewer, architect] }));
    expect(latest?.relay).toMatchObject({
      speaking: 1,
      total: 2,
      queue: [reviewer, architect],
    });

    act(() => callbacks.get('role-end')?.({ index: 1, total: 2 }));
    expect(latest?.relay?.speaking).toBe(2);

    act(() => callbacks.get('complete')?.({ ok: true, response: 'done' }));
    expect(latest?.relay).toBeNull();
  });

  it('targets run controls at the selected conversation after switching', async () => {
    const conversationAbort = vi.fn(async () => ({ ok: true }));
    const conversationStopRelay = vi.fn(async () => ({ ok: true }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { conversationAbort, conversationStopRelay },
    };
    setConversationLoading(keyA, true);
    setConversationLoading(keyB, true);
    mount(keyA);
    rerender(keyB);

    await act(async () => {
      expect(await latest?.abort()).toBe(true);
      expect(readConversationSnapshot(keyB).status).toBe('running');
      expect(await latest?.stopRelay()).toBe(true);
    });

    expect(conversationAbort).toHaveBeenCalledWith(scope, 'session-b');
    expect(conversationStopRelay).toHaveBeenCalledWith(scope, 'session-b');
  });

  it('rejects a stale surface send when the shared conversation is already running', async () => {
    const listen = () => () => undefined;
    const conversationChat = vi.fn(async () => ({ ok: true, sessionId: 'session-a' }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: {
        onTextDelta: listen,
        onToolCall: listen,
        onToolResult: listen,
        onToolInputStart: listen,
        onToolInputDelta: listen,
        onToolInputEnd: listen,
        onClarifyRequest: listen,
        onChatComplete: listen,
        onRoleTurnStart: listen,
        onRoleTurnEnd: listen,
        conversationChat,
      },
    };
    mount(keyA);
    const staleSend = latest?.sendMessage;
    act(() => setConversationLoading(keyA, true));

    expect(await staleSend?.('second turn')).toBe(false);
    expect(conversationChat).not.toHaveBeenCalled();
  });
});
