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
  vi.restoreAllMocks();
});

describe('useChatComposerStateKeyed', () => {
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
