// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatPageRail, ChatPageTopbar } from '../ChatPageNavigationChrome';

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
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Show the Tab panel"]')?.disabled).toBe(false);

    act(() => root.unmount());
  });
});
