// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatMessage } from '../../../types';
import { useChatComposerState } from './useChatComposerState';
import { resetChatScopeActivityForTests } from './chatScopeActivityStore';
import { I18nProvider } from '../../../i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useChatComposerState>;
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

describe('useChatComposerState turn-complete refresh', () => {
  it('refreshes the session list after a turn completes', async () => {
    let completeHandler: ((result: { ok: boolean }) => void) | undefined;
    const listeners = {
      onTextDelta: vi.fn(() => () => undefined),
      onChatComplete: vi.fn((_sessionId: string, cb: (result: { ok: boolean }) => void) => {
        completeHandler = cb;
        return () => undefined;
      }),
      onToolCall: vi.fn(() => () => undefined),
      onToolResult: vi.fn(() => () => undefined),
      onToolInputStart: vi.fn(() => () => undefined),
      onToolInputDelta: vi.fn(() => () => undefined),
      onToolInputEnd: vi.fn(() => () => undefined),
      onVisualStream: vi.fn(() => () => undefined),
      onClarifyRequest: vi.fn(() => () => undefined),
      onRoleTurnStart: vi.fn(() => () => undefined),
      onRoleTurnEnd: vi.fn(() => () => undefined),
    };
    const listSessions = vi.fn(async () => ({ ok: true, sessions: [] }));
    const agent = {
      getHistory: vi.fn(async () => ({ ok: true, activeSessionId: null, messages: [] })),
      getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      prepareChat: vi.fn(async () => ({ ok: true as const, sessionId: 'run-1' })),
      startChat: vi.fn(async () => ({ ok: true })),
      getRunStatus: vi.fn(async () => ({ ok: true, active: true })),
      listSessions,
      getScopeRunningSessions: vi.fn(async () => ({ ok: true, conversationSessionIds: [] })),
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

    let sent = false;
    await act(async () => {
      sent = await latest!.sendMessage('hello');
    });
    expect(sent).toBe(true);
    // A completed turn must trigger a session-list refresh so the rail shows
    // the new message's preview / ordering without the user reopening it.
    await act(async () => {
      completeHandler?.({ ok: true });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(listSessions).toHaveBeenCalled());
  });
});
