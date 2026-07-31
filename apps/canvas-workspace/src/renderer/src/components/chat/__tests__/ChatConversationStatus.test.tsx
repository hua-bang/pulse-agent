// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatConversationStatus } from '../ChatConversationStatus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChatConversationStatus', () => {
  it('announces thread opening and exposes a failed load retry', () => {
    const retry = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatConversationStatus
          sessionLoading
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

  it('names a branch and opens the original conversation', () => {
    const openOriginal = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatConversationStatus
          conversationBranch={{ sourceSessionId: 'source', activeSessionId: 'branch' }}
          branchError="Unable to restore"
          onOpenOriginal={openOriginal}
        />
      </I18nProvider>,
    ));

    expect(host.textContent).toContain('Branched from the original conversation');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unable to restore');
    const openButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent === 'Open original');
    act(() => openButton?.click());
    expect(openOriginal).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it('explains when the same scope is generating in another surface', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatConversationStatus busyElsewhere />
      </I18nProvider>,
    ));

    expect(host.querySelector('[role="status"]')?.textContent)
      .toContain('Another chat view is generating in this scope');

    act(() => root.unmount());
  });
});
