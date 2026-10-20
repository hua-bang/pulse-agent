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

async function render(props: { disabled: boolean; newSessionDisabled?: boolean }) {
  document.body.appendChild(host);
  root = createRoot(host);
  const onNewSession = vi.fn(async () => {});
  await act(async () => root.render(
    <I18nProvider>
      <ChatHeader
        title="Current"
        sessionMenuOpen
        sessionMenuRef={createRef()}
        sessions={[]}
        otherSessions={[]}
        onToggleSessionMenu={async () => {}}
        onCloseSessionMenu={() => {}}
        onNewSession={onNewSession}
        onLoadSession={async () => {}}
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
  it('keeps New chat enabled when only session switching is blocked', async () => {
    const onNewSession = await render({ disabled: true, newSessionDisabled: false });
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
