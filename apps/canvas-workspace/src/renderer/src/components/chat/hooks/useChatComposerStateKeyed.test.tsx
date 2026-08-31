// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useChatComposerStateKeyed } from './useChatComposerStateKeyed';
import { I18nProvider } from '../../../i18n';
import {
  readConversationSnapshot,
  resetConversationStoreForTests,
  setConversationLoading,
  setConversationMessages,
} from './conversationStore';
import { conversationKey, type ConversationKey } from '../../../../../shared/conversation-runtime';

const scope = { kind: 'workspace', workspaceId: 'ws-a' } as const;
const keyA: ConversationKey = conversationKey(scope, 'session-a');
const keyB: ConversationKey = conversationKey(scope, 'session-b');

let host: HTMLDivElement | null;
let root: Root | null = null;
let latest: ReturnType<typeof useChatComposerStateKeyed> | null = null;

function Harness({ sessionId }: { sessionId: string | null }) {
  latest = useChatComposerStateKeyed({
    agentScope: scope,
    skipInitialHistory: true,
    eagerLoad: false,
    getRequestContext: () => undefined,
    conversationKeyOverride: sessionId,
  } as never);
  return null;
}

function LiveHarness() {
  latest = useChatComposerStateKeyed({
    agentScope: scope,
    skipInitialHistory: true,
    eagerLoad: false,
    getRequestContext: () => undefined,
  });
  return null;
}

function HistoryHarness() {
  latest = useChatComposerStateKeyed({
    agentScope: scope,
    skipInitialHistory: false,
    eagerLoad: false,
    getRequestContext: () => undefined,
  });
  return null;
}

function InputHarness() {
  latest = useChatComposerStateKeyed({
    agentScope: scope,
    skipInitialHistory: true,
    eagerLoad: false,
    getRequestContext: () => undefined,
    conversationKeyOverride: 'session-a',
  });
  return createElement('div', { ref: latest.editableRef, contentEditable: true });
}

function VisibilityHarness({ visible }: { visible: boolean }) {
  latest = useChatComposerStateKeyed({
    agentScope: scope,
    skipInitialHistory: false,
    eagerLoad: false,
    getRequestContext: () => undefined,
    conversationVisible: visible,
  });
  return null;
}

beforeEach(() => {
  resetConversationStoreForTests();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useChatComposerStateKeyed', () => {
  it('silently prewarms an empty conversation after a short delay', async () => {
    vi.useFakeTimers();
    const warmScope = vi.fn();
    const getHistory = vi.fn(async () => ({
      ok: true,
      activeSessionId: 'session-a',
      messages: [],
    }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { warmScope, getHistory },
    };
    const nextRoot = createRoot(host!);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(createElement(I18nProvider, null, createElement(HistoryHarness)));
      await Promise.resolve();
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(749); });
    expect(warmScope).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(warmScope).toHaveBeenCalledOnce();
    expect(warmScope).toHaveBeenCalledWith({ scope });
  });

  it('starts the same prewarm immediately on the first input', async () => {
    vi.useFakeTimers();
    const warmScope = vi.fn();
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = { agent: { warmScope } };
    const nextRoot = createRoot(host!);
    root = nextRoot;
    act(() => {
      nextRoot.render(createElement(I18nProvider, null, createElement(InputHarness)));
    });
    act(() => {
      latest!.editableRef.current!.textContent = 'hello';
      latest?.handleInput();
    });

    expect(warmScope).toHaveBeenCalledOnce();
    expect(warmScope).toHaveBeenCalledWith({ scope });
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(warmScope).toHaveBeenCalledOnce();
  });

  it('does not prewarm for an input event that leaves the composer empty', () => {
    vi.useFakeTimers();
    const warmScope = vi.fn();
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = { agent: { warmScope } };
    const nextRoot = createRoot(host!);
    root = nextRoot;
    act(() => {
      nextRoot.render(createElement(I18nProvider, null, createElement(InputHarness)));
    });
    expect(warmScope).not.toHaveBeenCalled();
    act(() => {
      latest!.editableRef.current!.textContent = '';
      latest?.handleInput();
    });

    expect(warmScope).not.toHaveBeenCalled();
  });

  it('prewarms immediately when an image attachment is accepted', async () => {
    vi.useFakeTimers();
    const warmScope = vi.fn();
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { warmScope },
      file: { saveImage: vi.fn(async () => ({ ok: true, filePath: '/tmp/image.png' })) },
    };
    const nextRoot = createRoot(host!);
    root = nextRoot;
    act(() => {
      nextRoot.render(createElement(I18nProvider, null, createElement(InputHarness)));
    });
    await act(async () => {
      latest?.handleAttachFiles([new File(['image'], 'image.png', { type: 'image/png' })]);
      await vi.runAllTimersAsync();
    });

    expect(warmScope).toHaveBeenCalledOnce();
    expect(warmScope).toHaveBeenCalledWith({ scope });
  });

  it('cancels delayed prewarm when the conversation becomes hidden', async () => {
    vi.useFakeTimers();
    const warmScope = vi.fn();
    const getHistory = vi.fn(async () => ({
      ok: true,
      activeSessionId: 'session-a',
      messages: [],
    }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { warmScope, getHistory },
    };
    const nextRoot = createRoot(host!);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(createElement(I18nProvider, null, createElement(VisibilityHarness, { visible: true })));
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    act(() => {
      nextRoot.render(createElement(I18nProvider, null, createElement(VisibilityHarness, { visible: false })));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(warmScope).not.toHaveBeenCalled();
  });

  it('switches the store selector when the selected conversation changes', () => {
    setConversationMessages(keyA, [{ role: 'user', content: 'A', timestamp: 0 }]);
    setConversationMessages(keyB, [{ role: 'user', content: 'B', timestamp: 0 }]);

    const nextRoot = createRoot(host!);
    root = nextRoot;
    act(() => {
      nextRoot.render(createElement(I18nProvider, null, createElement(Harness, { sessionId: 'session-a' })));
    });
    expect(latest?.messages.map(m => m.content)).toEqual(['A']);

    act(() => {
      nextRoot.render(createElement(I18nProvider, null, createElement(Harness, { sessionId: 'session-b' })));
    });
    expect(latest?.messages.map(m => m.content)).toEqual(['B']);
  });

  it('hydrates the loaded conversation before adopting its selector', async () => {
    setConversationMessages(keyA, [{ role: 'user', content: 'A stays here', timestamp: 0 }]);
    const loadSession = vi.fn(async () => ({
      ok: true,
      activeSessionId: 'session-b',
      messages: [{ role: 'user' as const, content: 'B loaded', timestamp: 1 }],
    }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { loadSession },
    };
    const nextRoot = createRoot(host!);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(createElement(I18nProvider, null, createElement(LiveHarness)));
    });

    await act(async () => {
      await latest?.handleLoadSession('session-b');
    });

    expect(readConversationSnapshot(keyA).messages.map(m => m.content)).toEqual(['A stays here']);
    expect(readConversationSnapshot(keyB).messages.map(m => m.content)).toEqual(['B loaded']);
    expect(latest?.messages.map(m => m.content)).toEqual(['B loaded']);
  });

  it('restores the authoritative current conversation after a stale-session rejection', async () => {
    const callbacks = new Map<string, (payload: any) => void>();
    const listen = (name: string) => (_sessionId: string, callback: (payload: any) => void) => {
      callbacks.set(name, callback);
      return () => undefined;
    };
    const restoredMessages = [
      { role: 'user' as const, content: 'latest thread', timestamp: 2 },
    ];
    const agent = {
      warmScope: vi.fn(),
      loadSession: vi.fn(async () => ({
        ok: true,
        activeSessionId: 'session-a',
        messages: [{ role: 'user' as const, content: 'stale thread', timestamp: 1 }],
      })),
      getHistory: vi.fn(async () => ({
        ok: true,
        activeSessionId: 'session-b',
        messages: restoredMessages,
      })),
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
        callbacks.get('complete')?.({
          ok: false,
          code: 'CHAT_SESSION_CHANGED',
          error: 'This conversation no longer exists. The latest thread was restored.',
        });
        return { ok: true, sessionId: 'session-a' };
      }),
    };
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = { agent };
    const nextRoot = createRoot(host!);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(createElement(I18nProvider, null, createElement(LiveHarness)));
    });
    await act(async () => {
      await latest?.handleLoadSession('session-a');
    });

    await act(async () => {
      expect(await latest?.sendMessage('message for deleted thread')).toBe(true);
      await Promise.resolve();
    });

    expect(agent.getHistory).toHaveBeenCalledWith({ scope });
    expect(latest?.activeSessionId).toBe('session-b');
    expect(latest?.messages).toEqual(restoredMessages);
    expect(latest?.conversationError)
      .toBe('This conversation no longer exists. The latest thread was restored.');
  });

  it('does not let recovery override a newer explicit session load', async () => {
    let finishRecovery!: (result: {
      ok: true;
      activeSessionId: string;
      messages: Array<{ role: 'user'; content: string; timestamp: number }>;
    }) => void;
    const getHistory = vi.fn(() => new Promise(resolve => { finishRecovery = resolve; }));
    const loadSession = vi.fn(async () => ({
      ok: true,
      activeSessionId: 'session-newer',
      messages: [{ role: 'user' as const, content: 'newer intent', timestamp: 3 }],
    }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { getHistory, loadSession },
    };
    const nextRoot = createRoot(host!);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(createElement(I18nProvider, null, createElement(LiveHarness)));
    });

    let recovering!: Promise<{ sessionId: string; error: string } | null>;
    await act(async () => {
      recovering = latest!.recoverChangedSession('Conversation changed');
      await Promise.resolve();
    });
    await act(async () => {
      await latest!.handleLoadSession('session-newer');
    });
    await act(async () => {
      finishRecovery({
        ok: true,
        activeSessionId: 'session-older',
        messages: [{ role: 'user', content: 'older recovery', timestamp: 2 }],
      });
      expect(await recovering).toBeNull();
    });

    expect(latest?.activeSessionId).toBe('session-newer');
    expect(latest?.messages.map(message => message.content)).toEqual(['newer intent']);
  });

  it('does not replace a running conversation with stale persisted history', async () => {
    setConversationMessages(keyB, [
      { role: 'user', content: 'live current turn', timestamp: 2 },
      { role: 'assistant', content: 'streaming reply', timestamp: 3 },
    ]);
    setConversationLoading(keyB, true);
    const loadSession = vi.fn(async () => ({
      ok: true,
      activeSessionId: 'session-b',
      messages: [{ role: 'assistant' as const, content: 'old persisted reply', timestamp: 1 }],
    }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { loadSession },
    };
    const nextRoot = createRoot(host!);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(createElement(I18nProvider, null, createElement(LiveHarness)));
    });

    await act(async () => {
      await latest?.handleLoadSession('session-b');
    });

    expect(readConversationSnapshot(keyB).messages.map(message => message.content))
      .toEqual(['live current turn', 'streaming reply']);
    expect(latest?.messages.map(message => message.content))
      .toEqual(['live current turn', 'streaming reply']);
  });

  it('rejects hydration that started before a running turn completed', async () => {
    let finishLoad!: (result: {
      ok: true;
      activeSessionId: string;
      messages: Array<{ role: 'assistant'; content: string; timestamp: number }>;
    }) => void;
    const loadSession = vi.fn(() => new Promise(resolve => { finishLoad = resolve; }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { loadSession },
    };
    setConversationMessages(keyB, [
      { role: 'user', content: 'live current turn', timestamp: 2 },
    ]);
    setConversationLoading(keyB, true);
    const nextRoot = createRoot(host!);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(createElement(I18nProvider, null, createElement(LiveHarness)));
    });

    let loading: Promise<boolean | undefined> | undefined;
    await act(async () => {
      loading = latest?.handleLoadSession('session-b');
      await Promise.resolve();
    });
    act(() => {
      setConversationMessages(keyB, [
        { role: 'user', content: 'live current turn', timestamp: 2 },
        { role: 'assistant', content: 'completed reply', timestamp: 3 },
      ]);
      setConversationLoading(keyB, false);
    });
    finishLoad({
      ok: true,
      activeSessionId: 'session-b',
      messages: [{ role: 'assistant', content: 'old persisted reply', timestamp: 1 }],
    });
    await act(async () => { await loading; });

    expect(readConversationSnapshot(keyB).messages.map(message => message.content))
      .toEqual(['live current turn', 'completed reply']);
  });

  it('applies the same revision guard to initial current-session history', async () => {
    let finishHistory!: (result: {
      ok: true;
      activeSessionId: string;
      messages: Array<{ role: 'assistant'; content: string; timestamp: number }>;
    }) => void;
    const getHistory = vi.fn(() => new Promise(resolve => { finishHistory = resolve; }));
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { getHistory },
    };
    setConversationMessages(keyB, [{ role: 'user', content: 'live turn', timestamp: 2 }]);
    setConversationLoading(keyB, true);
    const nextRoot = createRoot(host!);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(createElement(I18nProvider, null, createElement(HistoryHarness)));
      await Promise.resolve();
    });
    act(() => {
      setConversationMessages(keyB, [
        { role: 'user', content: 'live turn', timestamp: 2 },
        { role: 'assistant', content: 'completed', timestamp: 3 },
      ]);
      setConversationLoading(keyB, false);
    });
    finishHistory({
      ok: true,
      activeSessionId: 'session-b',
      messages: [{ role: 'assistant', content: 'stale history', timestamp: 1 }],
    });
    await act(async () => { await Promise.resolve(); });

    expect(readConversationSnapshot(keyB).messages.map(message => message.content))
      .toEqual(['live turn', 'completed']);
  });
});
