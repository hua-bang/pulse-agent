// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatHeader } from '../ChatHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChatHeader cross-scope sessions', () => {
  it('shows other-workspace conversations directly and opens them in their owning scope', () => {
    const openInScope = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatHeader
          title="Current chat"
          sessionMenuOpen
          sessionMenuRef={createRef<HTMLDivElement>()}
          sessions={[]}
          otherSessions={[{
            sessionId: 'other-session',
            sourceWorkspaceId: 'workspace-b',
            workspaceName: 'Workspace B',
            date: '2026-07-31',
            messageCount: 3,
            isCurrent: false,
            title: 'Release review',
          }]}
          onToggleSessionMenu={vi.fn(async () => undefined)}
          onCloseSessionMenu={vi.fn()}
          onNewSession={vi.fn(async () => undefined)}
          onLoadSession={vi.fn(async () => undefined)}
          onOpenOriginalSession={openInScope}
          onOpenSettings={vi.fn()}
          settingsLabel="Settings"
          onOpenPromptSettings={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    ));

    const releaseReview = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Release review'));
    expect(releaseReview).not.toBeUndefined();
    act(() => releaseReview?.click());
    expect(openInScope).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'other-session' }));
    expect(host.textContent).not.toContain('All conversations');
    expect(host.textContent).not.toContain('Copy here');

    act(() => root.unmount());
  });
});
