// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { ChatHeader } from '../ChatHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChatHeader cross-scope sessions', () => {
  it('requires an explicit choice between opening the owning scope and copying here', () => {
    const openInScope = vi.fn();
    const copyHere = vi.fn(async () => undefined);
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
          onCopyOtherSession={copyHere}
          onOpenSettings={vi.fn()}
          settingsLabel="Settings"
          onOpenPromptSettings={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    ));

    expect(host.textContent).toContain('Release review');
    const openButton = host.querySelector<HTMLButtonElement>('[aria-label="Open in its scope"]');
    const copyButton = host.querySelector<HTMLButtonElement>('[aria-label="Copy here"]');
    expect(openButton).not.toBeNull();
    expect(copyButton).not.toBeNull();
    act(() => openButton?.click());
    act(() => copyButton?.click());
    expect(openInScope).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'other-session' }));
    expect(copyHere).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'other-session' }));

    act(() => root.unmount());
  });
});
