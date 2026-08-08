// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatConversationStatus } from '../ChatConversationStatus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChatConversationStatus', () => {
  it('announces thread opening while stale messages are still on screen, and exposes a failed load retry', () => {
    const retry = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatConversationStatus
          sessionLoading
          hasMessages
          sessionError={{ message: 'Session unavailable' }}
          onRetrySession={retry}
        />
      </I18nProvider>,
    ));

    expect(host.querySelector('[role="status"]')?.textContent).toContain('Opening conversation');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Session unavailable');
    const retryButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent === 'Retry');
    act(() => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it('suppresses the opening banner when the thread is empty, since ChatThreadSkeleton already covers that wait', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatConversationStatus sessionLoading hasMessages={false} />
      </I18nProvider>,
    ));

    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).toBe('');

    act(() => root.unmount());
  });

  it('does not insert an opening banner when the session rail already shows the pending conversation', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatConversationStatus
          sessionLoading
          hasMessages
          sessionLoadingFeedback="external"
          sessionError={{ message: 'Session unavailable' }}
        />
      </I18nProvider>,
    ));

    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).not.toContain('Opening conversation');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Session unavailable');

    act(() => root.unmount());
  });

  it('shows a conversation update failure without exposing implementation details', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatConversationStatus
          hasMessages
          conversationError="Unable to update this conversation"
        />
      </I18nProvider>,
    ));

    expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain('Unable to update this conversation');
    expect(host.textContent).not.toContain('branch');
    expect(host.querySelector('button')).toBeNull();

    act(() => root.unmount());
  });

  it('explains when the same scope is generating in another surface', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatConversationStatus hasMessages busyElsewhere />
      </I18nProvider>,
    ));

    expect(host.querySelector('[role="status"]')?.textContent)
      .toContain('Another chat view is generating in this scope');

    act(() => root.unmount());
  });
});
