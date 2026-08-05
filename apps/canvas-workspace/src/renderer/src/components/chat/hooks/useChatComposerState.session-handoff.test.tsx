// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentChatMessage, AgentRequestContext } from '../../../types';
import { I18nProvider } from '../../../i18n';
import { resetChatScopeActivityForTests } from './chatScopeActivityStore';
import { useChatComposerState } from './useChatComposerState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useChatComposerState>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function streamListeners(unsubscribe = vi.fn()) {
  const subscribe = vi.fn(() => unsubscribe);
  return {
    unsubscribe,
    listeners: {
      onTextDelta: subscribe,
      onChatComplete: subscribe,
      onToolCall: subscribe,
      onToolResult: subscribe,
      onToolInputStart: subscribe,
      onToolInputDelta: subscribe,
      onToolInputEnd: subscribe,
      onVisualStream: subscribe,
      onClarifyRequest: subscribe,
      onRoleTurnStart: subscribe,
      onRoleTurnEnd: subscribe,
    },
  };
}

const sourceMessages: AgentChatMessage[] = [
  { role: 'user', content: 'Original question', timestamp: 1 },
  { role: 'assistant', content: 'Original answer', timestamp: 2 },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Hook | null = null;

const HookProbe = () => {
  latest = useChatComposerState({ agentScope: { kind: 'global' } });
  return null;
};

const Probe = () => <I18nProvider><HookProbe /></I18nProvider>;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  resetChatScopeActivityForTests();
  vi.restoreAllMocks();
});

describe('useChatComposerState session handoff', () => {
  it('blocks a competing submit while regenerate is preparing its branch', async () => {
    const branch = deferred<{
      ok: true;
      sourceSessionId: string;
      activeSessionId: string;
      messages: AgentChatMessage[];
    }>();
    const { listeners } = streamListeners();
    const prepareChat = vi.fn(async () => ({ ok: true as const, sessionId: 'run-branch' }));
    const agent = {
      getHistory: vi.fn(async () => ({
        ok: true,
        activeSessionId: 'session-source',
        messages: sourceMessages,
      })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      branchSession: vi.fn(() => branch.promise),
      prepareChat,
      startChat: vi.fn(async () => ({ ok: true })),
      getRunStatus: vi.fn(async () => ({ ok: true, active: true })),
      ...listeners,
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent, model: { status: vi.fn(async () => ({ ok: true })) } },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root?.render(<Probe />); });
    await vi.waitFor(() => expect(latest?.sessionLoading).toBe(false));

    let regeneration!: Promise<boolean>;
    await act(async () => {
      regeneration = latest!.regenerateAssistantMessage(1);
    });

    let competingSent = true;
    await act(async () => {
      competingSent = await latest!.sendMessage('Competing message');
    });
    expect(competingSent).toBe(false);
    expect(prepareChat).not.toHaveBeenCalled();
    expect(latest?.messages).toEqual(sourceMessages);

    let regenerated = false;
    await act(async () => {
      branch.resolve({
        ok: true,
        sourceSessionId: 'session-source',
        activeSessionId: 'session-branch',
        messages: [],
      });
      regenerated = await regeneration;
    });

    expect(regenerated).toBe(true);
    expect(prepareChat).toHaveBeenCalledTimes(1);
    expect(prepareChat).toHaveBeenCalledWith(
      { scope: { kind: 'global' } },
      'Original question',
      undefined,
      expect.objectContaining({ expectedConversationSessionId: 'session-branch' }),
      undefined,
    );
    expect(latest?.messages.map(message => message.content)).toEqual(['Original question']);
  });

  it('sends an immediate regenerate into the branch session acknowledged by main', async () => {
    const unsubscribe = () => vi.fn();
    const prepareChat = vi.fn(async (
      _scope: unknown,
      _text: string,
      _mentionedWorkspaceIds: string[] | undefined,
      requestContext: AgentRequestContext,
    ) => requestContext.expectedConversationSessionId === 'session-branch'
      ? { ok: true, sessionId: 'run-branch' }
      : {
          ok: false,
          code: 'CHAT_SESSION_CHANGED',
          error: 'The renderer sent a stale conversation session id',
        });
    const agent = {
      getHistory: vi.fn(async () => ({
        ok: true,
        activeSessionId: 'session-source',
        messages: sourceMessages,
      })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      branchSession: vi.fn(async () => ({
        ok: true,
        sourceSessionId: 'session-source',
        activeSessionId: 'session-branch',
        messages: [],
      })),
      prepareChat,
      startChat: vi.fn(async () => ({ ok: true })),
      getRunStatus: vi.fn(async () => ({ ok: true, active: true })),
      onTextDelta: unsubscribe,
      onChatComplete: unsubscribe,
      onToolCall: unsubscribe,
      onToolResult: unsubscribe,
      onToolInputStart: unsubscribe,
      onToolInputDelta: unsubscribe,
      onToolInputEnd: unsubscribe,
      onVisualStream: unsubscribe,
      onClarifyRequest: unsubscribe,
      onRoleTurnStart: unsubscribe,
      onRoleTurnEnd: unsubscribe,
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        agent,
        model: {
          status: vi.fn(async () => ({ ok: true })),
        },
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe />);
    });
    await vi.waitFor(() => expect(latest?.sessionLoading).toBe(false));

    let regenerated = false;
    await act(async () => {
      regenerated = await latest!.regenerateAssistantMessage(1);
    });

    expect(prepareChat).toHaveBeenCalledWith(
      { scope: { kind: 'global' } },
      'Original question',
      undefined,
      expect.objectContaining({
        expectedConversationSessionId: 'session-branch',
      }),
      undefined,
    );
    expect(regenerated).toBe(true);
  });

  it('lets a later session selection retire a pending regenerate branch', async () => {
    const branch = deferred<{
      ok: boolean;
      sourceSessionId: string;
      activeSessionId: string;
      messages: AgentChatMessage[];
    }>();
    const load = deferred<{
      ok: boolean;
      activeSessionId: string;
      messages: AgentChatMessage[];
    }>();
    const selectedMessages: AgentChatMessage[] = [
      { role: 'user', content: 'Selected conversation', timestamp: 3 },
    ];
    const unsubscribe = () => vi.fn();
    const agent = {
      getHistory: vi.fn(async () => ({
        ok: true,
        activeSessionId: 'session-source',
        messages: sourceMessages,
      })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      branchSession: vi.fn(() => branch.promise),
      loadSession: vi.fn(() => load.promise),
      prepareChat: vi.fn(async () => ({
        ok: false,
        code: 'CHAT_SESSION_CHANGED',
        error: 'A retired branch must not send',
      })),
      onTextDelta: unsubscribe,
      onChatComplete: unsubscribe,
      onToolCall: unsubscribe,
      onToolResult: unsubscribe,
      onToolInputStart: unsubscribe,
      onToolInputDelta: unsubscribe,
      onToolInputEnd: unsubscribe,
      onVisualStream: unsubscribe,
      onClarifyRequest: unsubscribe,
      onRoleTurnStart: unsubscribe,
      onRoleTurnEnd: unsubscribe,
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        agent,
        model: {
          status: vi.fn(async () => ({ ok: true })),
        },
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe />);
    });
    await vi.waitFor(() => expect(latest?.sessionLoading).toBe(false));

    let regeneration!: Promise<boolean>;
    await act(async () => {
      regeneration = latest!.regenerateAssistantMessage(1);
    });
    let selection!: Promise<boolean | undefined>;
    await act(async () => {
      selection = latest!.handleLoadSession('session-selected');
    });

    let regenerated = true;
    await act(async () => {
      branch.resolve({
        ok: true,
        sourceSessionId: 'session-source',
        activeSessionId: 'session-branch',
        messages: [],
      });
      regenerated = await regeneration;
    });
    expect(latest?.messages).toEqual(sourceMessages);
    await act(async () => {
      load.resolve({
        ok: true,
        activeSessionId: 'session-selected',
        messages: selectedMessages,
      });
      await selection;
    });

    expect(regenerated).toBe(false);
    expect(agent.prepareChat).not.toHaveBeenCalled();
    expect(latest?.activeSessionId).toBe('session-selected');
    expect(latest?.messages).toEqual(selectedMessages);
  });

  it('rolls a superseded branch turn back to the branch baseline, not the source thread', async () => {
    const branchPrepare = deferred<{ ok: true; sessionId: string }>();
    const { listeners } = streamListeners();
    const agent = {
      getHistory: vi.fn(async () => ({
        ok: true,
        activeSessionId: 'session-source',
        messages: sourceMessages,
      })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      branchSession: vi.fn(async () => ({
        ok: true,
        sourceSessionId: 'session-source',
        activeSessionId: 'session-branch',
        messages: [] as AgentChatMessage[],
      })),
      loadSession: vi.fn(async () => ({ ok: false, error: 'load failed' })),
      prepareChat: vi.fn(() => branchPrepare.promise),
      cancelPreparedChat: vi.fn(async () => ({ ok: true })),
      getRunStatus: vi.fn(async () => ({ ok: true, active: true })),
      ...listeners,
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent, model: { status: vi.fn(async () => ({ ok: true })) } },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root?.render(<Probe />); });
    await vi.waitFor(() => expect(latest?.sessionLoading).toBe(false));

    let regeneration!: Promise<boolean>;
    await act(async () => {
      regeneration = latest!.regenerateAssistantMessage(1);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(agent.prepareChat).toHaveBeenCalled();
    expect(latest?.messages.map(message => message.content)).toEqual(['Original question']);

    await act(async () => {
      expect(await latest!.handleLoadSession('session-missing')).toBe(false);
    });
    expect(latest?.messages).toEqual([]);
    expect(latest?.loading).toBe(false);

    await act(async () => {
      branchPrepare.resolve({ ok: true, sessionId: 'run-branch' });
      expect(await regeneration).toBe(false);
    });
    expect(agent.cancelPreparedChat).toHaveBeenCalledWith('run-branch');
    expect(latest?.messages).toEqual([]);
  });

  it('retires a prepare-pending turn without letting its late result reset a newer turn', async () => {
    const oldPrepare = deferred<{ ok: true; sessionId: string }>();
    const failedLoad = deferred<{ ok: false; error: string }>();
    const selectedLoad = deferred<{
      ok: true;
      activeSessionId: string;
      messages: AgentChatMessage[];
    }>();
    const newStart = deferred<{ ok: false; error: string }>();
    const selectedMessages: AgentChatMessage[] = [
      { role: 'user', content: 'Selected conversation', timestamp: 3 },
    ];
    const { listeners } = streamListeners();
    const prepareChat = vi.fn((_scope: unknown, text: string) => (
      text === 'Old pending'
        ? oldPrepare.promise
        : Promise.resolve({ ok: true as const, sessionId: 'run-new' })
    ));
    const agent = {
      getHistory: vi.fn(async () => ({
        ok: true,
        activeSessionId: 'session-source',
        messages: sourceMessages,
      })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      loadSession: vi.fn()
        .mockImplementationOnce(() => failedLoad.promise)
        .mockImplementationOnce(() => selectedLoad.promise),
      prepareChat,
      cancelPreparedChat: vi.fn(async () => ({ ok: true })),
      startChat: vi.fn(() => newStart.promise),
      getRunStatus: vi.fn(async () => ({ ok: true, active: true })),
      ...listeners,
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent, model: { status: vi.fn(async () => ({ ok: true })) } },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root?.render(<Probe />); });
    await vi.waitFor(() => expect(latest?.sessionLoading).toBe(false));

    let oldSend!: Promise<boolean>;
    await act(async () => {
      oldSend = latest!.sendMessage('Old pending');
      await Promise.resolve();
    });
    expect(latest?.loading).toBe(true);

    let failedSelection!: Promise<boolean | undefined>;
    await act(async () => {
      failedSelection = latest!.handleLoadSession('session-missing');
      await Promise.resolve();
    });
    await act(async () => {
      failedLoad.resolve({ ok: false, error: 'load failed' });
      expect(await failedSelection).toBe(false);
    });
    expect(latest?.loading).toBe(false);
    expect(latest?.messages).toEqual(sourceMessages);

    let selection!: Promise<boolean | undefined>;
    await act(async () => {
      selection = latest!.handleLoadSession('session-selected');
      await Promise.resolve();
    });
    expect(latest?.loading).toBe(false);
    await act(async () => {
      selectedLoad.resolve({
        ok: true,
        activeSessionId: 'session-selected',
        messages: selectedMessages,
      });
      await selection;
    });

    let newSend!: Promise<boolean>;
    await act(async () => {
      newSend = latest!.sendMessage('New live turn');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(agent.startChat).toHaveBeenCalledWith('run-new');
    expect(latest?.loading).toBe(true);

    await act(async () => {
      oldPrepare.resolve({ ok: true, sessionId: 'run-old' });
      expect(await oldSend).toBe(false);
    });
    expect(agent.cancelPreparedChat).toHaveBeenCalledWith('run-old');
    expect(latest?.loading).toBe(true);
    expect(latest?.messages.map(message => message.content)).toEqual([
      'Selected conversation',
      'New live turn',
    ]);

    await act(async () => {
      newStart.resolve({ ok: false, error: 'test cleanup' });
      await newSend;
    });
  });

  it('retires a start-pending turn before new-session and ignores its late acknowledgement', async () => {
    const oldStart = deferred<{ ok: true }>();
    const newStart = deferred<{ ok: false; error: string }>();
    const newSession = deferred<{ ok: true; activeSessionId: string }>();
    const { listeners, unsubscribe } = streamListeners();
    const agent = {
      getHistory: vi.fn(async () => ({
        ok: true,
        activeSessionId: 'session-source',
        messages: sourceMessages,
      })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      newSession: vi.fn(() => newSession.promise),
      prepareChat: vi.fn((_scope: unknown, text: string) => Promise.resolve({
        ok: true as const,
        sessionId: text === 'Old starting' ? 'run-old' : 'run-new',
      })),
      startChat: vi.fn((sessionId: string) => (
        sessionId === 'run-old' ? oldStart.promise : newStart.promise
      )),
      getRunStatus: vi.fn(async () => ({ ok: true, active: true })),
      ...listeners,
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent, model: { status: vi.fn(async () => ({ ok: true })) } },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root?.render(<Probe />); });
    await vi.waitFor(() => expect(latest?.sessionLoading).toBe(false));

    let oldSend!: Promise<boolean>;
    await act(async () => {
      oldSend = latest!.sendMessage('Old starting');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(agent.startChat).toHaveBeenCalledWith('run-old');

    let createSession!: ReturnType<Hook['handleNewSession']>;
    await act(async () => {
      createSession = latest!.handleNewSession();
      await Promise.resolve();
    });
    expect(latest?.loading).toBe(false);
    expect(unsubscribe).toHaveBeenCalled();
    await act(async () => {
      newSession.resolve({ ok: true, activeSessionId: 'session-new' });
      await createSession;
    });
    expect(latest?.messages).toEqual([]);

    let liveSend!: Promise<boolean>;
    await act(async () => {
      liveSend = latest!.sendMessage('New live turn');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(agent.startChat).toHaveBeenCalledWith('run-new');
    expect(latest?.loading).toBe(true);

    await act(async () => {
      oldStart.resolve({ ok: true });
      expect(await oldSend).toBe(false);
    });
    expect(latest?.loading).toBe(true);
    expect(latest?.messages.map(message => message.content)).toEqual(['New live turn']);

    await act(async () => {
      newStart.resolve({ ok: false, error: 'test cleanup' });
      await liveSend;
    });
  });
});
