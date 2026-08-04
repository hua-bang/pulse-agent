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

  it('lets keyboard users activate a session mention chip', async () => {
    const onSessionJump = vi.fn();
    const el = await renderMessages(
      [{
        role: 'assistant',
        content: '@[session:workspace-2:session-2:4|Earlier decision]',
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

    expect(onSessionJump).toHaveBeenCalledWith('session-2', 'workspace-2', 4);
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

  it('shows a stopped turn with one keyboard-operable recovery action', async () => {
    const onRegenerate = vi.fn(async () => true);
    const el = await renderMessages([{
      role: 'assistant',
      content: 'A partial response.',
      timestamp: 1,
      turnStatus: 'stopped',
      retryable: true,
    }], { onRegenerate });

    expect(el.querySelector('.chat-turn-outcome--stopped')?.textContent).toContain('Stopped');
    const continueButton = Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === 'Continue');
    expect(continueButton).toBeTruthy();

    await act(async () => {
      continueButton?.click();
    });
    expect(onRegenerate).toHaveBeenCalledWith(0);
    expect(el.querySelector('[aria-label="Regenerate response"]')).toBeNull();
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
