// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatPageRail, ChatPageTopbar } from '../ChatPageBody/ChatPageNavigationChrome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rail = {
  allSessions: [],
  onNewSession: vi.fn(),
  onSelectSession: vi.fn(),
};

describe('ChatPage navigation chrome', () => {
  it('unmounts collapsed rail controls and exposes the toggle relationship', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatPageRail collapsed rail={rail} />
        <ChatPageTopbar
          workspaceLabel="Workspace A"
          sessionTitleSource="@[dom:dom-1|Quarterly%20plan] Summarize this"
          railCollapsed
          onToggleRail={vi.fn()}
          anchors={[]}
          onJumpAnchor={vi.fn()}
          onNewSession={vi.fn()}
          newSessionDisabled={false}
          dockTabsVisible={false}
          onToggleDockTabs={vi.fn()}
        />
      </I18nProvider>,
    ));

    const railElement = host.querySelector('#chat-page-session-rail');
    expect(railElement?.getAttribute('aria-hidden')).toBe('true');
    expect(railElement?.querySelector('button')).toBeNull();
    const toggle = host.querySelector<HTMLButtonElement>('[aria-controls="chat-page-session-rail"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[aria-label="Settings"]')).toBeNull();
    expect(host.querySelectorAll('.chat-page-topbar > .chat-panel-action-btn')).toHaveLength(3);
    expect(host.querySelector('.chat-page-topbar-session-title')?.textContent).toBe('Quarterly plan Summarize this');
    expect(host.querySelector('.chat-page-topbar-workspace')?.textContent).toBe('Workspace A');
    const newChat = host.querySelector<HTMLButtonElement>('[aria-label="New AI chat"]');
    expect(newChat?.hasAttribute('aria-controls')).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Show the Tab panel"]')?.disabled).toBe(false);

    act(() => root.unmount());
  });

  it('falls back to New AI chat only while the session rail is collapsed', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const renderTopbar = (railCollapsed: boolean) => (
      <I18nProvider>
        <ChatPageTopbar
          workspaceLabel="Workspace A"
          railCollapsed={railCollapsed}
          onToggleRail={vi.fn()}
          anchors={[]}
          onJumpAnchor={vi.fn()}
          onNewSession={vi.fn()}
          newSessionDisabled={false}
          dockTabsVisible={false}
          onToggleDockTabs={vi.fn()}
        />
      </I18nProvider>
    );

    act(() => root.render(renderTopbar(true)));
    expect(host.querySelector('.chat-page-topbar-session-title')?.textContent).toBe('New AI chat');
    expect(host.querySelector('.chat-page-topbar-workspace')?.textContent).toBe('Workspace A');

    act(() => root.render(renderTopbar(false)));
    expect(host.querySelector('.chat-page-topbar-session-title')).toBeNull();
    expect(host.querySelector('.chat-page-topbar-workspace')?.textContent).toBe('Workspace A');

    act(() => root.unmount());
  });
});
