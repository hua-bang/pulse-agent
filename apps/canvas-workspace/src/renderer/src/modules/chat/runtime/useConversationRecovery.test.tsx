// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationKey } from '../../../../../shared/conversation-runtime';
import type { AgentChatMessage } from '../../../types';
import { resetConversationStoreForTests, setConversationMessages } from './conversationStore';
import { findAnsweredUserIndex, useConversationRecovery } from './useConversationRecovery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const key = conversationKey({ kind: 'workspace', workspaceId: 'ws-a' }, 'session-a');
const image = { id: 'img-1', path: '/tmp/a.png', fileName: 'a.png', mimeType: 'image/png', status: 'ready' as const };
const history: AgentChatMessage[] = [
  { role: 'user', content: 'first', timestamp: 1 },
  { role: 'assistant', content: 'one', timestamp: 2 },
  { role: 'user', content: 'second', timestamp: 3, attachments: [image] },
  { role: 'assistant', content: 'partial', timestamp: 4, turnStatus: 'stopped' },
];

let host: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useConversationRecovery>;
const sendMessage = vi.fn(async () => true);

function Harness() {
  latest = useConversationRecovery(key, sendMessage);
  return null;
}

beforeEach(() => {
  resetConversationStoreForTests();
  setConversationMessages(key, history);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe('conversation recovery', () => {
  it('maps an assistant or stopped message to the user turn it answered', () => {
    expect(findAnsweredUserIndex(history, 3)).toBe(2);
    expect(findAnsweredUserIndex(history, 1)).toBe(0);
    expect(findAnsweredUserIndex(history.slice(1, 2), 0)).toBe(-1);
  });

  it('regenerates by resending the answered user turn in place with its attachments', async () => {
    let accepted: boolean | undefined;
    await act(async () => { accepted = await latest.regenerateAssistantMessage(3); });

    expect(accepted).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith('second', undefined, [image], 2);
  });

  it('edits a user turn in place, keeping its attachments', async () => {
    await act(async () => { await latest.editUserMessage(2, 'revised'); });

    expect(sendMessage).toHaveBeenCalledWith('revised', undefined, [image], 2);
  });

  it('refuses to edit a non-user message or to clear a turn', async () => {
    expect(await latest.editUserMessage(1, 'revised')).toBe(false);
    expect(await latest.editUserMessage(2, '   ')).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
