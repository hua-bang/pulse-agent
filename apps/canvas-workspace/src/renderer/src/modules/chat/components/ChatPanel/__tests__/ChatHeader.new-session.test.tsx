// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { ChatHeader } from '../ChatHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root.unmount()); host.remove(); });

const onLoadSession = vi.fn(async () => {});

async function render(props: { disabled: boolean; switchDisabled?: boolean }) {
  document.body.appendChild(host);
  root = createRoot(host);
  onLoadSession.mockClear();
  const onNewSession = vi.fn(async () => {});
  await act(async () => root.render(
    <I18nProvider>
      <ChatHeader
        title="Current"
        sessionMenuOpen
        sessionMenuRef={createRef()}
        sessions={[
          { sessionId: 'current', date: 'Today', messageCount: 2, isCurrent: true, title: 'Current' },
          { sessionId: 'other', date: 'Today', messageCount: 4, isCurrent: false, title: 'Other chat' },
        ]}
        otherSessions={[]}
        onToggleSessionMenu={async () => {}}
        onCloseSessionMenu={() => {}}
        onNewSession={onNewSession}
        onLoadSession={onLoadSession}
        onOpenSettings={() => {}}
        settingsLabel="Settings"
        onOpenPromptSettings={() => {}}
        onClose={() => {}}
        {...props}
      />
    </I18nProvider>,
  ));
  return onNewSession;
}

const newChatButtons = () => [
  host.querySelector<HTMLButtonElement>('.chat-session-menu-new')!,
  host.querySelector<HTMLButtonElement>('.chat-panel-action-btn[aria-label="New AI chat"]')!,
];

describe('ChatHeader New chat while a reply streams', () => {
  it('keeps the chat list and switching enabled while a reply streams', async () => {
    await render({ disabled: true, switchDisabled: false });
    const title = host.querySelector<HTMLButtonElement>('.chat-panel-title-btn')!;
    expect(title.disabled).toBe(false);
    const other = Array.from(host.querySelectorAll<HTMLElement>('.chat-session-menu-list [role="menuitem"]'))
      .find((item) => item.textContent?.includes('Other chat'))!;
    await act(async () => other.click());
    expect(onLoadSession).toHaveBeenCalledWith('other');
  });

  it('keeps New chat enabled when only session switching is blocked', async () => {
    const onNewSession = await render({ disabled: true, switchDisabled: false });
    const [menuNew, actionNew] = newChatButtons();
    expect(menuNew.disabled).toBe(false);
    expect(actionNew.disabled).toBe(false);
    await act(async () => actionNew.click());
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it('follows disabled when no narrower rule is given', async () => {
    await render({ disabled: true });
    expect(newChatButtons().every((button) => button.disabled)).toBe(true);
  });
});
