// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentChatMessage,
  AgentRequestContext,
  AgentScope,
  ChatImageAttachment,
} from '../../../types';
import { useConversationBranching } from './useConversationBranching';
import { I18nProvider } from '../../../i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const originalMessages: AgentChatMessage[] = [
  { role: 'user', content: 'first', timestamp: 1 },
  { role: 'assistant', content: 'first answer', timestamp: 2 },
  {
    role: 'user',
    content: 'second',
    timestamp: 3,
    contextSnapshot: {
      scope: { kind: 'global' },
      scopeLabel: 'Global chat',
      executionMode: 'ask',
      modelLabel: 'Original model',
      capturedAt: 3,
    },
  },
  { role: 'assistant', content: 'second answer', timestamp: 4 },
];
const branchedMessages = originalMessages.slice(0, 2);

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: ReturnType<typeof useConversationBranching> | null = null;
let replaceMessages: ReturnType<typeof vi.fn>;
let sendMessage: ReturnType<typeof vi.fn<[
  string,
  AgentRequestContext?,
  ChatImageAttachment[]?,
], Promise<boolean>>>;
let onActiveSessionChange: ReturnType<typeof vi.fn>;
let conversationEpochRef: { current: number };

const HookProbe = ({ agentScope }: { agentScope: AgentScope }) => {
  latest = useConversationBranching({
    agentScope,
    loading: false,
    messages: originalMessages,
    replaceMessages,
    sendMessageForMutation: (_generation, text, requestContext, attachments) => (
      sendMessage(text, requestContext, attachments)
    ),
    onActiveSessionChange,
    conversationEpochRef,
  });
  return null;
};
const Probe = ({ agentScope = { kind: 'global' } }: { agentScope?: AgentScope }) => (
  <I18nProvider><HookProbe agentScope={agentScope} /></I18nProvider>
);

beforeEach(async () => {
  replaceMessages = vi.fn();
  sendMessage = vi.fn<[
    string,
    AgentRequestContext?,
    ChatImageAttachment[]?,
  ], Promise<boolean>>(async () => true);
  onActiveSessionChange = vi.fn();
  conversationEpochRef = { current: 0 };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<Probe />);
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  vi.restoreAllMocks();
});

describe('useConversationBranching', () => {
  it('keeps the source thread visible until main durably acknowledges the branch', async () => {
    const branch = deferred<{
      ok: boolean;
      sourceSessionId: string;
      activeSessionId: string;
      messages: AgentChatMessage[];
    }>();
    const agent = {
      branchSession: vi.fn(() => branch.promise),
      loadSession: vi.fn(),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });

    let editing!: Promise<boolean>;
    await act(async () => {
      editing = latest!.editUserMessage(2, 'revised second');
    });

    expect(replaceMessages).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      branch.resolve({
        ok: true,
        sourceSessionId: 'session-source',
        activeSessionId: 'session-branch',
        messages: branchedMessages,
      });
      await editing;
    });

    expect(replaceMessages).toHaveBeenCalledWith(branchedMessages);
    expect(onActiveSessionChange).toHaveBeenCalledWith('session-branch');
    expect(sendMessage).toHaveBeenCalledWith(
      'revised second',
      expect.objectContaining({ executionMode: 'ask' }),
      [],
    );
    expect(latest?.conversationError).toBeNull();
  });

  it('keeps branching as an internal history-protection detail', async () => {
    const agent = {
      branchSession: vi.fn(async () => ({
        ok: true,
        sourceSessionId: 'session-source',
        activeSessionId: 'session-branch',
        messages: branchedMessages,
      })),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });

    await act(async () => {
      await latest!.regenerateAssistantMessage(3);
    });
    expect(sendMessage).toHaveBeenCalledWith('second', expect.anything(), []);
    expect(latest?.conversationError).toBeNull();
  });

  it('does not apply a delayed branch after the visible scope changes', async () => {
    const branch = deferred<{
      ok: boolean;
      sourceSessionId: string;
      activeSessionId: string;
      messages: AgentChatMessage[];
    }>();
    const agent = {
      branchSession: vi.fn(() => branch.promise),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });

    let editing!: Promise<boolean>;
    await act(async () => {
      editing = latest!.editUserMessage(2, 'revised second');
    });
    await act(async () => {
      root?.render(
        <Probe agentScope={{ kind: 'workspace', workspaceId: 'workspace-next' }} />,
      );
    });

    let edited = true;
    await act(async () => {
      branch.resolve({
        ok: true,
        sourceSessionId: 'session-source',
        activeSessionId: 'session-old-branch',
        messages: branchedMessages,
      });
      edited = await editing;
    });

    expect(edited).toBe(false);
    expect(replaceMessages).not.toHaveBeenCalled();
    expect(onActiveSessionChange).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not apply a delayed branch after the active conversation changes in the same scope', async () => {
    const branch = deferred<{
      ok: boolean;
      sourceSessionId: string;
      activeSessionId: string;
      messages: AgentChatMessage[];
    }>();
    const agent = {
      branchSession: vi.fn(() => branch.promise),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });

    let editing!: Promise<boolean>;
    await act(async () => {
      editing = latest!.editUserMessage(2, 'revised second');
    });
    conversationEpochRef.current += 1;

    let edited = true;
    await act(async () => {
      branch.resolve({
        ok: true,
        sourceSessionId: 'session-source',
        activeSessionId: 'session-stale-branch',
        messages: branchedMessages,
      });
      edited = await editing;
    });

    expect(edited).toBe(false);
    expect(replaceMessages).not.toHaveBeenCalled();
    expect(onActiveSessionChange).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not apply a delayed branch after the scope leaves and returns', async () => {
    const branch = deferred<{
      ok: boolean;
      sourceSessionId: string;
      activeSessionId: string;
      messages: AgentChatMessage[];
    }>();
    const agent = {
      branchSession: vi.fn(() => branch.promise),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });

    let editing!: Promise<boolean>;
    await act(async () => {
      editing = latest!.editUserMessage(2, 'revised second');
    });
    await act(async () => {
      root?.render(
        <Probe agentScope={{ kind: 'workspace', workspaceId: 'workspace-next' }} />,
      );
    });
    await act(async () => {
      root?.render(<Probe agentScope={{ kind: 'global' }} />);
    });

    let edited = true;
    await act(async () => {
      branch.resolve({
        ok: true,
        sourceSessionId: 'session-source',
        activeSessionId: 'session-stale-branch',
        messages: branchedMessages,
      });
      edited = await editing;
    });

    expect(edited).toBe(false);
    expect(replaceMessages).not.toHaveBeenCalled();
    expect(onActiveSessionChange).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
