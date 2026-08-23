// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n';
import { AppShellProvider } from '../shell/AppShellProvider';
import { conversationKey } from '../../../../shared/conversation-runtime';
import {
  recordConversationCompletion,
  resetConversationCompletionStoreForTests,
  setConversationVisible,
} from './hooks/conversationCompletionStore';
import { ConversationCompletionToastBridge } from './ConversationCompletionToastBridge';

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
        <ConversationCompletionToastBridge />
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
});
