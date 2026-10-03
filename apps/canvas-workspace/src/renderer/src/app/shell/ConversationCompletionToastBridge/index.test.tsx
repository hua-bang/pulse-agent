// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../AppShellProvider';
import { conversationKey } from '../../../../../shared/conversation-runtime';
import {
  recordConversationCompletion,
  resetConversationCompletionStoreForTests,
  setConversationVisible,
} from '../../../modules/chat/completion';
import { ConversationCompletionToastBridge } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
const key = conversationKey({ kind: 'workspace', workspaceId: 'ws-a' }, 'session-a');

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  resetConversationCompletionStoreForTests();
});

describe('ConversationCompletionToastBridge', () => {
  it('toasts background completion once but suppresses visible completion', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(
      <I18nProvider><AppShellProvider>
        <ConversationCompletionToastBridge onOpenSessionInScope={vi.fn()} />
      </AppShellProvider></I18nProvider>,
    ));

    act(() => recordConversationCompletion(key, 'done', 'run-1', 'Background chat'));
    expect(host.textContent).toContain('“Background chat” finished');

    act(() => {
      setConversationVisible(key, true);
      recordConversationCompletion(key, 'done', 'run-2', 'Visible chat');
    });
    expect(host.textContent).not.toContain('“Visible chat” finished');
    act(() => setConversationVisible(key, false));
  });
  it.each([
    ['ws-b', { kind: 'workspace', workspaceId: 'ws-b' }],
    ['__global_chat__', { kind: 'global' }],
    ['__scheduled__-task-a', { kind: 'scheduled', taskId: 'task-a' }],
  ])('opens the exact completed conversation in %s', async (storeId, scope) => {
    const open = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(
      <I18nProvider><AppShellProvider>
        <ConversationCompletionToastBridge onOpenSessionInScope={open} />
      </AppShellProvider></I18nProvider>,
    ));
    act(() => recordConversationCompletion(
      { storeId: String(storeId), sessionId: 'exact-session' }, 'done', 'exact-run', 'Background',
    ));
    const button = host.querySelector<HTMLButtonElement>('.shell-toast__action');
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
      await vi.waitFor(() => expect(open).toHaveBeenCalled());
    });
    expect(open).toHaveBeenCalledWith(scope, 'exact-session', 'Background');
    expect(host.querySelector('.shell-toast')).toBeNull();
  });

});
