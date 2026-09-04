// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { AgentChatMessage } from '../../../types';
import { conversationKey, type ConversationKey } from '../../../../../shared/conversation-runtime';
import { useConversationRuntimeStream } from './useConversationRuntimeStream';
import { I18nProvider } from '../../../i18n';
import { resetConversationStoreForTests, setConversationMessages } from './conversationStore';

const scope = { kind: 'workspace', workspaceId: 'ws-a' } as const;
const keyA: ConversationKey = conversationKey(scope, 'session-a');

let host: HTMLDivElement | null;
let root: Root | null = null;
let surfaceA: ReturnType<typeof useConversationRuntimeStream> | null = null;
let surfaceB: ReturnType<typeof useConversationRuntimeStream> | null = null;

function Surface({ label }: { label: 'a' | 'b' }) {
  const result = useConversationRuntimeStream({ agentScope: scope, conversationKey: keyA });
  if (label === 'a') surfaceA = result;
  else surfaceB = result;
  return null;
}

function mountBoth(): void {
  if (!host) throw new Error('host not initialized');
  const nextRoot = createRoot(host);
  root = nextRoot;
  act(() => {
    nextRoot.render(createElement(I18nProvider, null, createElement(Surface, { label: 'a' })));
  });
}

function mountSecond(): void {
  if (!root) throw new Error('root not mounted');
  const activeRoot = root;
  act(() => {
    activeRoot.render(createElement(I18nProvider, null, createElement(Surface, { label: 'a' }), createElement(Surface, { label: 'b' })));
  });
}

beforeEach(() => {
  resetConversationStoreForTests();
  host = document.createElement('div');
  document.body.appendChild(host);
  surfaceA = null;
  surfaceB = null;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  resetConversationStoreForTests();
  vi.restoreAllMocks();
});

describe('useConversationRuntimeStream shared snapshot (Dock + Full-page contract)', () => {
  it('two surfaces subscribed to the same conversation key read the same snapshot', () => {
    // Surface A mounts first; a sibling (surface B) mounts later and both
    // share the conversation store, so B sees A's messages without a replay.
    mountBoth();
    expect(surfaceA).not.toBeNull();

    // Simulate a sibling surface writing the thread to the store.
    act(() => {
      setConversationMessages(keyA, [
        { role: 'user', content: 'from sibling', timestamp: 1 },
      ] as AgentChatMessage[]);
    });

    mountSecond();
    expect(surfaceB?.messages.map(m => m.content)).toEqual(['from sibling']);
  });
});
