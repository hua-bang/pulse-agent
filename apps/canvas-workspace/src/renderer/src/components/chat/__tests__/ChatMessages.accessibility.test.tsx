// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import type { AgentChatMessage } from '../../../types';
import { ChatMessages } from '../ChatMessages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const baseProps = {
  loading: false,
  workspaceId: 'workspace-1',
  streamingTools: [],
  messageTools: new Map(),
  collapsedSections: new Set<number>(),
  expandedTools: new Set<number>(),
  pendingClarify: null,
  clarifyInput: '',
  onClarifyInputChange: vi.fn(),
  onAnswerClarification: vi.fn(async () => undefined),
  onToggleSection: vi.fn(),
  onToggleToolExpand: vi.fn(),
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function renderMessages(
  messages: AgentChatMessage[],
  overrides: Partial<ComponentProps<typeof ChatMessages>> = {},
): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <ChatMessages {...baseProps} {...overrides} messages={messages} />
      </I18nProvider>,
    );
  });
  return host;
}

describe('ChatMessages accessibility', () => {
  it('exposes a polite conversation log with labelled message speakers', async () => {
    const el = await renderMessages([
      { role: 'user', content: 'Can you review this?', timestamp: 1 },
      { role: 'assistant', content: 'Yes.', timestamp: 2 },
      {
        role: 'assistant',
        content: 'I have one concern.',
        timestamp: 3,
        speakerRoleName: 'Product reviewer',
      },
    ]);

    const log = el.querySelector<HTMLElement>('.chat-messages');
    expect(log?.getAttribute('role')).toBe('log');
    expect(log?.getAttribute('aria-label')).toBe('Conversation messages');
    expect(log?.getAttribute('aria-live')).toBe('polite');
    expect(log?.getAttribute('aria-relevant')).toBe('additions');

    const messages = Array.from(el.querySelectorAll<HTMLElement>('.chat-message[role="article"]'));
    expect(messages.map((message) => message.getAttribute('aria-label'))).toEqual([
      'You',
      'Pulse AI',
      'Product reviewer',
    ]);
  });

  it.each([
    ['__global_chat__', 'session-global', 3],
    ['__scheduled__-task-1', 'session-scheduled', 4],
    ['workspace-2', 'session-workspace', 5],
  ])('lets keyboard users activate a %s session mention chip', async (
    workspaceId,
    sessionId,
    messageIndex,
  ) => {
    const onSessionJump = vi.fn();
    const el = await renderMessages(
      [{
        role: 'assistant',
        content: `@[session:${workspaceId}:${sessionId}:${messageIndex}|Earlier decision]`,
        timestamp: 1,
      }],
      { onSessionJump },
    );

    const chip = el.querySelector<HTMLElement>('[data-action="session-jump"]');
    expect(chip?.getAttribute('role')).toBe('button');
    expect(chip?.tabIndex).toBe(0);

    await act(async () => {
      chip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onSessionJump).toHaveBeenCalledWith(sessionId, workspaceId, messageIndex);
  });

  it('carries dock workspace identity when reopening a tab and exposes a stale result', async () => {
    const onActivate = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<{
        tabId: string;
        dockWorkspaceId?: string;
        respond: (result: { status: 'activated' | 'stale' }) => void;
      }>).detail;
      detail.respond({ status: 'stale' });
    });
    window.addEventListener('canvas:activate-dock-tab', onActivate);
    const el = await renderMessages([{
      role: 'user',
      content: '@[tab:link%3Adocs|link|workspace-2|Product%20docs]',
      timestamp: 1,
    }]);
    const chip = el.querySelector<HTMLElement>('[data-action="tab-jump"]');

    await act(async () => {
      chip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onActivate).toHaveBeenCalledOnce();
    const detail = (onActivate.mock.calls[0]?.[0] as CustomEvent).detail;
    expect(detail.tabId).toBe('link:docs');
    expect(detail.dockWorkspaceId).toBe('workspace-2');
    expect(chip?.getAttribute('aria-disabled')).toBe('true');
    expect(chip?.classList.contains('chat-mention-chip--stale')).toBe(true);
    expect(el.querySelector('.chat-tab-navigation-feedback')?.textContent)
      .toBe('“Product docs” is no longer available. It may have been closed.');
    window.removeEventListener('canvas:activate-dock-tab', onActivate);
  });

  it('carries a persisted link URL so a closed historical tab can be reopened', async () => {
    const identity = Array.from(new TextEncoder().encode(JSON.stringify({
      url: 'https://example.com/docs',
      workspaceId: 'workspace-2',
    })), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const onActivate = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<{
        tab?: { url?: string; workspaceId?: string };
        respond: (result: { status: 'activated' | 'reopened' | 'stale' }) => void;
      }>).detail;
      detail.respond({ status: 'reopened' });
    });
    window.addEventListener('canvas:activate-dock-tab', onActivate);
    const el = await renderMessages([{
      role: 'user',
      content: `@[tab:link%3Adocs|link|workspace-2|Product%20docs|ref=${identity}]`,
      timestamp: 1,
    }]);
    const chip = el.querySelector<HTMLElement>('[data-action="tab-jump"]');
    expect(chip?.dataset.tabUrl).toBe('https://example.com/docs');
    expect(chip?.dataset.tabWorkspaceId).toBe('workspace-2');

    await act(async () => { chip?.click(); });

    const detail = (onActivate.mock.calls[0]?.[0] as CustomEvent).detail;
    expect(detail.tab).toMatchObject({
      id: 'link:docs',
      kind: 'link',
      title: 'Product docs',
      url: 'https://example.com/docs',
      workspaceId: 'workspace-2',
      dockWorkspaceId: 'workspace-2',
    });
    expect(el.querySelector('.chat-tab-navigation-feedback')?.textContent)
      .toBe('Reopened “Product docs”.');
    expect(chip?.hasAttribute('aria-disabled')).toBe(false);
    window.removeEventListener('canvas:activate-dock-tab', onActivate);
  });

  it('ignores a late tab-activation receipt after the user chooses another tab', async () => {
    const responses: Array<(result: { status: 'activated' | 'stale' }) => void> = [];
    const onActivate = (event: Event) => {
      responses.push((event as CustomEvent<{ respond: typeof responses[number] }>).detail.respond);
    };
    window.addEventListener('canvas:activate-dock-tab', onActivate);
    const el = await renderMessages([{
      role: 'user',
      content: [
        '@[tab:link%3Afirst|link|workspace-1|First]',
        '@[tab:link%3Asecond|link|workspace-1|Second]',
      ].join(' '),
      timestamp: 1,
    }]);
    const chips = Array.from(el.querySelectorAll<HTMLElement>('[data-action="tab-jump"]'));

    await act(async () => {
      chips[0]?.click();
      chips[1]?.click();
      responses[0]?.({ status: 'stale' });
      responses[1]?.({ status: 'activated' });
    });

    expect(chips[0]?.classList.contains('chat-mention-chip--stale')).toBe(false);
    expect(el.querySelector('.chat-tab-navigation-feedback')?.textContent)
      .toBe('Opened “Second”.');
    window.removeEventListener('canvas:activate-dock-tab', onActivate);
  });

  it('moves to the latest message when a different session finishes loading', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const priorMessages: AgentChatMessage[] = [
      { role: 'user', content: 'Old question', timestamp: 1 },
      { role: 'assistant', content: 'Old answer', timestamp: 2 },
    ];
    await renderMessages(priorMessages);

    const scroller = host?.querySelector<HTMLElement>('.chat-messages');
    Object.defineProperties(scroller!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    await act(async () => {
      scroller?.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    scrollIntoView.mockClear();

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMessages {...baseProps} messages={priorMessages} sessionLoading />
        </I18nProvider>,
      );
    });
    const nextMessages: AgentChatMessage[] = [
      { role: 'user', content: 'New question', timestamp: 3 },
      { role: 'assistant', content: 'New answer', timestamp: 4 },
    ];
    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMessages {...baseProps} messages={nextMessages} sessionLoading={false} />
        </I18nProvider>,
      );
    });

    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto' });
  });

  it('restores each conversation scroll position when switching sessions', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    const messages: AgentChatMessage[] = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${index + 1}`,
      timestamp: index + 1,
    }));
    await renderMessages(messages, { conversationKey: 'scroll-cache-a' });

    const scroller = host?.querySelector<HTMLElement>('.chat-messages');
    Object.defineProperties(scroller!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 120, writable: true },
    });
    await act(async () => {
      scroller?.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMessages
            {...baseProps}
            messages={messages}
            conversationKey="scroll-cache-b"
          />
        </I18nProvider>,
      );
    });
    if (scroller) scroller.scrollTop = 360;
    await act(async () => {
      scroller?.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMessages
            {...baseProps}
            messages={messages}
            conversationKey="scroll-cache-a"
          />
        </I18nProvider>,
      );
    });

    expect(scroller?.scrollTop).toBe(120);
  });

  it('avoids smooth scrolling when reduced motion is requested', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    await renderMessages([]);
    scrollIntoView.mockClear();

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMessages
            {...baseProps}
            messages={[{ role: 'user', content: 'New question', timestamp: 1 }]}
          />
        </I18nProvider>,
      );
    });

    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto' });
  });

  it('announces generation and completion outside the muted token stream', async () => {
    const el = await renderMessages([], { loading: true });

    expect(el.querySelector('.chat-messages')?.getAttribute('aria-busy')).toBeNull();
    const status = el.querySelector<HTMLElement>('.chat-turn-status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.getAttribute('aria-atomic')).toBe('true');
    expect(status?.textContent).toBe('Generating...');
    expect(el.querySelector('.chat-message:has(.chat-loading)')?.getAttribute('aria-hidden')).toBe('true');

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMessages
            {...baseProps}
            messages={[{ role: 'assistant', content: 'Done.', timestamp: 1 }]}
            loading={false}
          />
        </I18nProvider>,
      );
    });
    expect(status?.textContent).toBe('Response complete.');
  });

  it('announces a stopped turn instead of claiming the response completed', async () => {
    const el = await renderMessages([], { loading: true });
    const status = el.querySelector<HTMLElement>('.chat-turn-status');

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMessages
            {...baseProps}
            messages={[{
              role: 'assistant',
              content: 'A partial response.',
              timestamp: 1,
              turnStatus: 'stopped',
              retryable: true,
            }]}
            loading={false}
          />
        </I18nProvider>,
      );
    });

    expect(status?.textContent).toBe('Stopped');
  });

  it('announces a failed turn instead of claiming the response completed', async () => {
    const el = await renderMessages([], { loading: true });
    const status = el.querySelector<HTMLElement>('.chat-turn-status');

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMessages
            {...baseProps}
            messages={[{
              role: 'assistant',
              content: '',
              timestamp: 1,
              turnStatus: 'failed',
              errorDetails: 'ProviderError: unavailable',
              retryable: true,
            }]}
            loading={false}
          />
        </I18nProvider>,
      );
    });

    expect(status?.textContent).toBe('Response failed');
  });

  it('keeps clarification pending, visible, and non-stealing while an answer is sent', async () => {
    const el = await renderMessages([], {
      pendingClarify: { id: 'clarify-1', question: 'Which workspace?' },
      clarifyInput: 'Product',
      clarificationAnswering: true,
      clarificationError: 'The answer could not be delivered.',
    });

    const card = el.querySelector<HTMLElement>('.chat-message--clarification');
    expect(card?.getAttribute('role')).toBe('status');
    expect(card?.getAttribute('aria-live')).toBe('polite');
    expect(card?.getAttribute('aria-busy')).toBe('true');

    const input = el.querySelector<HTMLInputElement>('.chat-clarify-input');
    expect(input?.autofocus).toBe(false);
    expect(input?.disabled).toBe(true);
    expect(input?.getAttribute('aria-invalid')).toBe('true');

    const error = el.querySelector<HTMLElement>('.chat-clarify-error');
    expect(input?.getAttribute('aria-describedby')).toBe(error?.id);
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toBe('The answer could not be delivered.');

    const submit = el.querySelector<HTMLButtonElement>('.chat-clarify-submit');
    expect(submit?.disabled).toBe(true);
    expect(submit?.textContent).toBe('Sending…');
  });

  it('keeps a remote clarification actionable while the rest of the conversation is read-only', async () => {
    const onAnswerClarification = vi.fn(async () => undefined);
    const el = await renderMessages([], {
      pendingClarify: { id: 'clarify-1', question: 'Which workspace?' },
      clarifyInput: 'Product',
      interactionDisabled: true,
      onAnswerClarification,
    });

    expect(el.querySelector<HTMLInputElement>('.chat-clarify-input')?.disabled).toBe(false);
    const submit = el.querySelector<HTMLButtonElement>('.chat-clarify-submit');
    expect(submit?.disabled).toBe(false);
    await act(async () => submit?.click());
    expect(onAnswerClarification).toHaveBeenCalledOnce();
  });

  it('renders approval requests as explicit fail-closed actions', async () => {
    const onAnswerClarification = vi.fn(async () => undefined);
    const el = await renderMessages([], {
      pendingClarify: {
        id: 'approval-1',
        kind: 'approval',
        question: 'Allow write operation “canvas_update_node”?',
        defaultAnswer: 'No',
      },
      interactionDisabled: true,
      onAnswerClarification,
    });

    expect(el.querySelector('.chat-clarify-input')).toBeNull();
    expect(el.textContent).toContain('No response defaults to Reject.');
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
    const approve = buttons.find(button => button.textContent === 'Approve');
    const reject = buttons.find(button => button.textContent === 'Reject');
    await act(async () => approve?.click());
    await act(async () => reject?.click());
    expect(onAnswerClarification).toHaveBeenNthCalledWith(1, 'Yes');
    expect(onAnswerClarification).toHaveBeenNthCalledWith(2, 'No');
  });

  it('labels a stopped-turn recovery as regeneration instead of continuation', async () => {
    const onRegenerate = vi.fn(async () => true);
    const el = await renderMessages([{
      role: 'assistant',
      content: 'A partial response.',
      timestamp: 1,
      turnStatus: 'stopped',
      retryable: true,
    }], { onRegenerate });

    expect(el.querySelector('.chat-turn-outcome--stopped')?.textContent).toContain('Stopped');
    const regenerateButton = Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === 'Regenerate');
    expect(regenerateButton).toBeTruthy();
    expect(regenerateButton?.title).toBe('Discards the partial response and starts again');

    await act(async () => {
      regenerateButton?.click();
    });
    expect(onRegenerate).toHaveBeenCalledWith(0);
    expect(el.querySelector('[aria-label="Regenerate response"]')).toBeNull();
  });

  it('hides an old stopped outcome after the user has moved the conversation on', async () => {
    const el = await renderMessages([
      {
        role: 'assistant',
        content: 'Please finish the sign-in in the browser.',
        timestamp: 1,
        turnStatus: 'stopped',
        retryable: true,
      },
      {
        role: 'user',
        content: 'That is handled. Continue another way.',
        timestamp: 2,
      },
      {
        role: 'assistant',
        content: 'Continuing with the updated request.',
        timestamp: 3,
      },
    ]);

    expect(el.querySelector('.chat-turn-outcome--stopped')).toBeNull();
  });

  it('keeps a failed turn friendly while disclosing raw diagnostics on demand', async () => {
    const onRegenerate = vi.fn(async () => true);
    const el = await renderMessages([{
      role: 'assistant',
      content: 'The AI service could not complete this reply.',
      timestamp: 1,
      turnStatus: 'failed',
      errorDetails: 'ProviderError: request_id=debug-only',
      retryable: true,
    }], { onRegenerate });

    expect(el.querySelector('.chat-message-content')?.textContent)
      .toContain('The AI service could not complete this reply.');
    expect(el.querySelector('.chat-turn-outcome--failed')?.textContent).toContain('Response failed');

    const details = el.querySelector<HTMLDetailsElement>('.chat-turn-error-details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Technical details');
    expect(details?.querySelector('pre')?.textContent).toBe('ProviderError: request_id=debug-only');

    const retryButton = Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === 'Try again');
    await act(async () => {
      retryButton?.click();
    });
    expect(onRegenerate).toHaveBeenCalledWith(0);
  });

  it('does not render turn context beneath its user turn (temporarily hidden)', async () => {
    // ChatMessage.tsx no longer wires ChatTurnContext up — the row saw little
    // user attention, so it's hidden for now even when the snapshot carries
    // references. ChatTurnMeta.tsx keeps the rendering logic intact.
    const el = await renderMessages([{
      role: 'user',
      content: 'Compare these.',
      timestamp: 1,
      contextSnapshot: {
        scope: { kind: 'workspace', workspaceId: 'workspace-1' },
        scopeLabel: 'Product canvas',
        executionMode: 'ask',
        modelLabel: 'GPT-5.6',
        capturedAt: 1,
        selectedNodes: [{ id: 'node-1', title: 'Roadmap', type: 'text' }],
        tags: [{ name: 'launch' }],
        canvases: [{ id: 'workspace-2', name: 'Research canvas' }],
      },
    }]);

    expect(el.querySelector('.chat-turn-context')).toBeNull();
  });

  it('renders no turn context when the snapshot carries no references', async () => {
    const el = await renderMessages([{
      role: 'user',
      content: 'Just a question.',
      timestamp: 1,
      contextSnapshot: {
        scope: { kind: 'workspace', workspaceId: 'workspace-1' },
        scopeLabel: 'Product canvas',
        executionMode: 'auto',
        modelLabel: 'GPT-5.6',
        capturedAt: 1,
      },
    }]);

    expect(el.querySelector('.chat-turn-context')).toBeNull();
  });
});
