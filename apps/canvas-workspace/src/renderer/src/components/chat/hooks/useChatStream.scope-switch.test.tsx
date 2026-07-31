// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatMessage } from '../../../types';
import type { AgentScope } from '../types';
import { useChatStream } from './useChatStream';
import { resetChatScopeActivityForTests } from './chatScopeActivityStore';
import { I18nProvider } from '../../../i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useChatStream>;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Hook | null = null;

const HookProbe = ({ scope }: { scope: AgentScope }) => {
  latest = useChatStream({ agentScope: scope });
  return null;
};
const Probe = ({ scope }: { scope: AgentScope }) => (
  <I18nProvider><HookProbe scope={scope} /></I18nProvider>
);

const message = (content: string): AgentChatMessage => ({
  role: 'user',
  content,
  timestamp: 1,
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  resetChatScopeActivityForTests();
  vi.restoreAllMocks();
});

describe('useChatStream scope switching', () => {
  it('keeps the rendered thread until the next scope history arrives', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(<Probe scope={{ kind: 'global' }} />);
    });
    await act(async () => {
      latest!.replaceMessages([message('current thread')]);
    });

    await act(async () => {
      root?.render(<Probe scope={{ kind: 'workspace', workspaceId: 'scope-switch-target' }} />);
    });

    expect(latest?.messages).toEqual([message('current thread')]);

    await act(async () => {
      latest!.replaceMessages([message('target thread')]);
    });
    expect(latest?.messages).toEqual([message('target thread')]);
  });

  it('cancels a delayed prepare and drops its continuation after scope changes', async () => {
    let finishPrepare: ((value: { ok: true; sessionId: string }) => void) | undefined;
    const prepare = new Promise<{ ok: true; sessionId: string }>((resolve) => {
      finishPrepare = resolve;
    });
    const cancelPreparedChat = vi.fn(async () => ({ ok: true }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        agent: {
          prepareChat: vi.fn(() => prepare),
          cancelPreparedChat,
          getScopeRunStatus: vi.fn(async () => ({ ok: true, active: false })),
        },
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<Probe scope={{ kind: 'global' }} />));

    let sending: Promise<boolean> | undefined;
    act(() => {
      sending = latest!.sendMessage('old-scope message');
    });
    await act(async () => {
      root?.render(<Probe scope={{ kind: 'workspace', workspaceId: 'new-scope' }} />);
      latest!.replaceMessages([message('new-scope thread')]);
    });
    await act(async () => {
      finishPrepare?.({ ok: true, sessionId: 'prepared-old-scope' });
      await sending;
    });

    expect(cancelPreparedChat).toHaveBeenCalledWith('prepared-old-scope');
    expect(latest?.messages).toEqual([message('new-scope thread')]);
  });
});
