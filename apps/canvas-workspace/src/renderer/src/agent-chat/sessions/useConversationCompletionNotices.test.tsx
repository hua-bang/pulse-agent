// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { conversationKeyId, conversationKey } from '../../../../shared/conversation-runtime';
import {
  readConversationCompletions,
  recordConversationCompletion,
  resetConversationCompletionStoreForTests,
} from '../runtime/conversationCompletionStore';
import { useConversationCompletionNotices } from './useConversationCompletionNotices';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest = new Map();
const key = conversationKey({ kind: 'workspace', workspaceId: 'ws-a' }, 'session-a');

function Probe({ selected }: { selected: string }) {
  latest = useConversationCompletionNotices({ selectedSessionKey: selected });
  return null;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  resetConversationCompletionStoreForTests();
});

describe('useConversationCompletionNotices', () => {
  it('projects completion badges and clears them when opened', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<Probe selected="ws-a:session-b" />));
    act(() => recordConversationCompletion(key, 'done', 'run-1'));

    expect(latest.get(conversationKeyId(key))).toBe('done');
    await act(async () => root?.render(<Probe selected="ws-a:session-a" />));
    expect(readConversationCompletions()).toEqual([]);
  });
});
