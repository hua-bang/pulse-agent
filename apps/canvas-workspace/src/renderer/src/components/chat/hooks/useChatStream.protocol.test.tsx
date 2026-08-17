// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatStream } from './useChatStream';
import { resetChatScopeActivityForTests } from './chatScopeActivityStore';
import { I18nProvider } from '../../../i18n';
import { cacheThread } from './chatThreadCache';
import { chatScopeId } from '../chatScope';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useChatStream>;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Hook | null = null;
const conversationSessionIdRef = { current: 'conversation-visible' as string | null };
const onContinuedTurn = vi.fn();

const HookProbe = () => {
  latest = useChatStream({
    agentScope: { kind: 'global' },
    conversationSessionIdRef,
    onContinuedTurn,
  });
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
  cacheThread(chatScopeId({ kind: 'global' }), []);
  vi.useRealTimers();
  vi.restoreAllMocks();
  onContinuedTurn.mockReset();
});

describe('chat stream startup protocol', () => {
  it('submits run input and requests guarded history reconciliation on completion', async () => {
    let complete: ((result: { ok: boolean; continued?: boolean; response?: string }) => void) | undefined;
    const unsubscribe = () => vi.fn();
    const agent = {
      prepareChat: vi.fn(async () => ({ ok: true, sessionId: 'run-input' })),
      startChat: vi.fn(async () => ({ ok: true })),
      submitRunInput: vi.fn(async () => ({ ok: true })),
      getRunStatus: vi.fn(async () => ({ ok: true, active: true })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      onTextDelta: unsubscribe,
      onChatComplete: (_sessionId: string, callback: typeof complete) => {
        complete = callback;
        return vi.fn();
      },
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
    Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: { agent } });
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => root?.render(<Probe />));
    await act(async () => { await latest?.sendMessage('first'); });

    await act(async () => { await latest?.submitRunInput('follow-up', 'next'); });
    expect(agent.submitRunInput).toHaveBeenCalledWith('run-input', 'follow-up', 'next');

    await act(async () => {
      complete?.({ ok: true, continued: true, response: 'continued' });
      await Promise.resolve();
    });
    expect(onContinuedTurn).toHaveBeenCalledOnce();
  });

  it('subscribes to every run channel before main starts the prepared turn', async () => {
    const order: string[] = [];
    const subscribe = (channel: string) => {
      order.push(`subscribe:${channel}`);
      return vi.fn();
    };
    const agent = {
      prepareChat: vi.fn(async () => {
        order.push('prepare');
        return { ok: true, sessionId: 'run-fast' };
      }),
      startChat: vi.fn(async () => {
        order.push('start');
        return {
          ok: true,
          modelProvider: 'provider-real',
          modelId: 'model-real',
          modelLabel: 'Model Real',
        };
      }),
      getRunStatus: vi.fn(async () => ({ ok: true, active: true })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      onTextDelta: () => subscribe('text'),
      onChatComplete: () => subscribe('complete'),
      onToolCall: () => subscribe('tool-call'),
      onToolResult: () => subscribe('tool-result'),
      onToolInputStart: () => subscribe('tool-input-start'),
      onToolInputDelta: () => subscribe('tool-input-delta'),
      onToolInputEnd: () => subscribe('tool-input-end'),
      onVisualStream: () => subscribe('visual'),
      onClarifyRequest: () => subscribe('clarify'),
      onRoleTurnStart: () => subscribe('role-start'),
      onRoleTurnEnd: () => subscribe('role-end'),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe />);
    });

    await act(async () => {
      await latest!.sendMessage('instant response');
    });

    expect(order[0]).toBe('prepare');
    expect(order.at(-1)).toBe('start');
    expect(order.indexOf('subscribe:complete')).toBeGreaterThan(order.indexOf('prepare'));
    expect(order.indexOf('subscribe:complete')).toBeLessThan(order.indexOf('start'));
    expect(agent.startChat).toHaveBeenCalledWith('run-fast');
    const prepareArgs = (agent.prepareChat.mock.calls as unknown[][])[0];
    expect(prepareArgs?.[3]).toMatchObject({
      expectedConversationSessionId: 'conversation-visible',
    });
    expect(latest?.messages[0]?.contextSnapshot).toMatchObject({
      modelProvider: 'provider-real',
      modelId: 'model-real',
      modelLabel: 'Model Real',
    });
  });

  it('keeps a clarification and its answer when main rejects the delivery', async () => {
    let onClarify: ((request: { id: string; question: string }) => void) | undefined;
    const unsubscribe = () => vi.fn();
    const answerClarification = vi.fn(async () => ({
      ok: false,
      error: 'Clarification expired',
    }));
    const agent = {
      prepareChat: vi.fn(async () => ({ ok: true, sessionId: 'run-clarify' })),
      startChat: vi.fn(async () => ({ ok: true })),
      getRunStatus: vi.fn(async () => ({ ok: true, active: true })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      onTextDelta: unsubscribe,
      onChatComplete: unsubscribe,
      onToolCall: unsubscribe,
      onToolResult: unsubscribe,
      onToolInputStart: unsubscribe,
      onToolInputDelta: unsubscribe,
      onToolInputEnd: unsubscribe,
      onVisualStream: unsubscribe,
      onClarifyRequest: (_sessionId: string, callback: typeof onClarify) => {
        onClarify = callback;
        return vi.fn();
      },
      onRoleTurnStart: unsubscribe,
      onRoleTurnEnd: unsubscribe,
      answerClarification,
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe />);
    });
    await act(async () => {
      await latest?.sendMessage('ask me');
    });
    act(() => {
      onClarify?.({ id: 'clarify-1', question: 'Which workspace?' });
      latest?.setClarifyInput('Workspace A');
    });

    await act(async () => {
      await latest!.answerClarification();
    });

    expect(answerClarification).toHaveBeenCalledWith(
      'run-clarify',
      'clarify-1',
      'Workspace A',
    );
    expect(latest?.pendingClarify).toMatchObject({ id: 'clarify-1' });
    expect(latest?.clarifyInput).toBe('Workspace A');
    expect(latest?.clarificationError).toBe('Clarification expired');
    expect(latest?.clarificationAnswering).toBe(false);
  });

  it('keeps the next serialized approval when it arrives during the previous answer', async () => {
    let onClarify: ((request: { id: string; question: string }) => void) | undefined;
    const unsubscribe = () => vi.fn();
    const agent = {
      prepareChat: vi.fn(async () => ({ ok: true, sessionId: 'run-approval-queue' })),
      startChat: vi.fn(async () => ({ ok: true })),
      getRunStatus: vi.fn(async () => ({ ok: true, active: true })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      onTextDelta: unsubscribe,
      onChatComplete: unsubscribe,
      onToolCall: unsubscribe,
      onToolResult: unsubscribe,
      onToolInputStart: unsubscribe,
      onToolInputDelta: unsubscribe,
      onToolInputEnd: unsubscribe,
      onVisualStream: unsubscribe,
      onClarifyRequest: (_sessionId: string, callback: typeof onClarify) => {
        onClarify = callback;
        return vi.fn();
      },
      onRoleTurnStart: unsubscribe,
      onRoleTurnEnd: unsubscribe,
      answerClarification: vi.fn(async () => {
        onClarify?.({ id: 'approval-second', question: 'Allow second write?' });
        return { ok: true };
      }),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<Probe />));
    await act(async () => { await latest?.sendMessage('make two changes'); });
    act(() => {
      onClarify?.({ id: 'approval-first', question: 'Allow first write?' });
      latest?.setClarifyInput('Yes');
    });

    await act(async () => { await latest?.answerClarification(); });

    expect(latest?.pendingClarify).toMatchObject({ id: 'approval-second' });
  });

  it('reattaches to a remote approval so a reopened surface can answer, stop, and recover', async () => {
    vi.useFakeTimers();
    let active = true;
    const answerClarification = vi.fn(async () => ({ ok: true }));
    const abort = vi.fn(async () => ({ ok: true }));
    const history = [{ role: 'assistant' as const, content: 'Recovered', timestamp: 2 }];
    const agent = {
      getScopeRunStatus: vi.fn(async () => active
        ? {
            ok: true,
            active: true,
            sessionId: 'remote-run',
            pendingClarification: {
              id: 'approval-1',
              kind: 'approval' as const,
              question: 'Allow write?',
              defaultAnswer: 'No',
            },
          }
        : { ok: true, active: false }),
      getHistory: vi.fn(async () => ({ ok: true, messages: history })),
      answerClarification,
      abort,
      stopRelay: vi.fn(async () => ({ ok: true })),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe />);
    });

    expect(latest?.loading).toBe(true);
    expect(latest?.busyElsewhere).toBe(true);
    expect(latest?.pendingClarify).toMatchObject({
      id: 'approval-1',
      kind: 'approval',
      defaultAnswer: 'No',
    });
    await act(async () => {
      await latest?.answerClarification('Yes');
      await latest?.abort();
    });
    expect(answerClarification).toHaveBeenCalledWith('remote-run', 'approval-1', 'Yes');
    expect(abort).toHaveBeenCalledWith('remote-run');

    active = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(latest?.loading).toBe(false);
    expect(latest?.messages).toEqual(history);
  });
});
