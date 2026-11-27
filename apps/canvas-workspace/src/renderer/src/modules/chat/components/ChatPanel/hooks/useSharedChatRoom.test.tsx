// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteVpsChatRoomEvent } from '../../../../../../../shared/api/remote-vps';
import type { AgentChatMessage } from '../../../../../types';
import { I18nProvider } from '../../../../../i18n';
import { useSharedChatRoom, type SharedChatRoomState } from './useSharedChatRoom';

vi.mock('../../../../../shared/appShell', () => ({
  useAppShell: () => ({ notify: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useSharedChatRoom streaming deduplication', () => {
  let host: HTMLDivElement;
  let emitEvent: ((ev: RemoteVpsChatRoomEvent) => void) | null = null;
  let latest: SharedChatRoomState | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    emitEvent = null;
    latest = null;
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      remoteVps: {
        getConfig: vi.fn(async () => ({ ok: true, config: { kind: 'vps', remoteWorkspaceId: 'ws-1' } })),
        subscribeChatRoom: vi.fn(async () => ({ ok: true })),
        unsubscribeChatRoom: vi.fn(async () => ({ ok: true })),
        getChatRoomState: vi.fn(async () => ({ ok: true, activeTurn: null, queue: [] })),
        onChatRoomEvent: vi.fn((cb: (ev: RemoteVpsChatRoomEvent) => void) => {
          emitEvent = cb;
          return () => {
            emitEvent = null;
          };
        }),
        streamChatRoom: vi.fn(async () => ({ ok: true })),
        releaseChatRoom: vi.fn(async () => ({ ok: true })),
        setChatRoomTyping: vi.fn(async () => ({ ok: true })),
      },
    };
  });

  afterEach(() => {
    host.remove();
  });

  function Harness(props: {
    messages: AgentChatMessage[];
    loading: boolean;
    conversationId?: string;
    reloadSession?: (sessionId?: string) => void;
  }) {
    latest = useSharedChatRoom({
      workspaceId: 'ws-1',
      conversationId: props.conversationId ?? 'sess-1',
      messages: props.messages,
      loading: props.loading,
      input: '',
      mentionOpen: false,
      onSubmit: async () => true,
      onKeyDown: () => {},
      sendMessage: () => {},
      clearInput: () => {},
      reloadSession: props.reloadSession ?? (() => {}),
    });
    return null;
  }

  it('never appends a duplicate peer bubble while locally loading, and updates trailing assistant in place', async () => {
    const root = createRoot(host);
    const initial: AgentChatMessage[] = [
      { role: 'user', content: 'hi', timestamp: 1 },
      { role: 'assistant', content: 'old partial', timestamp: 2 },
    ];

    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(Harness, { messages: initial, loading: true })),
      );
      await Promise.resolve();
    });

    act(() => {
      emitEvent?.({
        workspaceId: 'ws-1',
        conversationId: 'sess-1',
        activeTurn: {
          clientId: 'other-mac',
          senderName: 'Mac',
          conversationId: 'sess-1',
          prompt: 'hi',
          text: 'updated stream',
          startedAt: 1,
          updatedAt: 3,
          self: false,
        },
        queue: [],
      });
    });

    // While loading=true, local stream owns rendering — no extra peer message appended.
    expect(latest?.displayMessages).toHaveLength(2);
    expect(latest?.displayMessages[1].content).toBe('old partial');

    // Once loading=false, peer turn updates the matching trailing assistant message in-place (no duplicate user/assistant).
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(Harness, { messages: initial, loading: false })),
      );
    });
    expect(latest?.displayMessages).toHaveLength(2);
    expect(latest?.displayMessages[0].content).toBe('hi');
    expect(latest?.displayMessages[1].content).toBe('updated stream');

    await act(async () => {
      root.unmount();
    });
  });

  it('forwards peer sessionId to reloadSession when turnEnded fires on New AI chat', async () => {
    const root = createRoot(host);
    const reloadSession = vi.fn();

    await act(async () => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(Harness, { messages: [], loading: false, conversationId: 'draft-local-1', reloadSession }),
        ),
      );
      await Promise.resolve();
    });

    act(() => {
      emitEvent?.({
        workspaceId: 'ws-1',
        conversationId: 'sess-new-42',
        activeTurn: {
          clientId: 'other-mac',
          senderName: 'Mac',
          conversationId: 'sess-new-42',
          prompt: 'hello from Mac',
          text: 'streaming reply',
          startedAt: 1,
          updatedAt: 2,
          self: false,
        },
        queue: [],
      });
    });

    // Empty draft session (messages=[]) shows peer's live prompt + streaming assistant bubble.
    expect(latest?.displayMessages).toHaveLength(2);
    expect(latest?.displayMessages[0].content).toBe('hello from Mac');
    expect(latest?.displayMessages[1].content).toBe('streaming reply');

    act(() => {
      emitEvent?.({
        workspaceId: 'ws-1',
        conversationId: 'sess-new-42',
        activeTurn: null,
        queue: [],
        turnEnded: true,
        endedBySelf: false,
      });
    });

    expect(reloadSession).toHaveBeenCalledWith('sess-new-42');

    await act(async () => {
      root.unmount();
    });
  });
});
