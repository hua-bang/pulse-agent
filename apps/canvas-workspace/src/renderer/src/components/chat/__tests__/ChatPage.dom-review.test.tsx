// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { AgentContextDomReviewComment } from '../../../types';
import { I18nProvider } from '../../../i18n';
import { ChatTargetProvider, useChatTargetBroker } from '../ChatTargetContext';

const composer = vi.hoisted(() => ({
  focusInput: vi.fn(),
  sendMessage: vi.fn(async () => true),
}));

vi.mock('../hooks/useChatComposerState', () => ({
  useChatComposerState: () => ({
    activeSessionId: null,
    attachmentSendBlocked: false,
    attachments: [],
    busyElsewhere: false,
    canvasModels: {
      status: { apiKeyPresent: true },
      selectedLabel: 'Test model',
    },
    conversationError: null,
    currentScopeName: null,
    focusInput: composer.focusInput,
    input: '',
    loading: false,
    mentionItems: [],
    mentionOpen: false,
    messages: [],
    otherSessions: [],
    sendMessage: composer.sendMessage,
    sessionError: null,
    sessionLoading: false,
    sessions: [],
    sessionsLoading: false,
    sessionsStoreId: 'workspace-1',
  }),
}));

vi.mock('../hooks/useChatPageJumpNavigation', () => ({
  useChatPageJumpNavigation: () => ({ anchors: [], onJumpAnchor: vi.fn(), onSessionJump: vi.fn() }),
}));
vi.mock('../hooks/useChatPagePendingSession', () => ({
  useChatPagePendingSession: () => vi.fn(),
}));
vi.mock('../hooks/useChatPageSessionRail', () => ({
  useChatPageSessionRail: () => ({ allSessions: [], onNewSession: vi.fn() }),
}));
vi.mock('../../dock/RightDock/context', () => ({
  useRightDock: () => ({ newLink: vi.fn(), openCanvasPreview: vi.fn(), toggleContentTabs: vi.fn() }),
  useRightDockState: () => ({
    activeTabId: 'chat',
    expanded: false,
    mountedWorkspaceIds: new Set<string>(),
    tabs: [],
  }),
}));
vi.mock('../../shell/AppShellProvider', () => ({
  useAppShell: () => ({ notify: vi.fn() }),
}));
vi.mock('../ChatPageNavigationChrome', () => ({
  ChatPageRail: () => null,
  ChatPageTopbar: () => null,
}));
vi.mock('../ChatConversationStatus', () => ({ ChatConversationStatus: () => null }));
vi.mock('../ChatView', () => ({ ChatView: () => null }));

import { ChatPageBody } from '../ChatPageBody';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChatPage DOM review delivery', () => {
  it('submits reviews through the visible full-page composer target', async () => {
    composer.focusInput.mockReset();
    composer.sendMessage.mockClear();
    let broker: ReturnType<typeof useChatTargetBroker> | undefined;
    const Probe = () => {
      broker = useChatTargetBroker();
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(
      <I18nProvider>
        <ChatTargetProvider>
          <ChatPageBody
            agentScope={{ kind: 'workspace', workspaceId: 'workspace-1' }}
            contextSnapshot={{
              label: 'Workspace 1',
              requestContext: {
                scope: 'current_canvas',
                domSelections: [{
                  id: 'existing', label: 'Existing', nodeId: 'node-0', selector: '#existing',
                }],
              },
            }}
            initialPendingSessionId={null}
            pendingSessionId={null}
            pendingSessionIntentId={null}
            onSessionConsumed={vi.fn()}
            onSelectSession={vi.fn()}
            allWorkspaces={[{ id: 'workspace-1', name: 'Workspace 1' }]}
            onExit={vi.fn()}
            railCollapsed
            onToggleRail={vi.fn()}
            onOpenAppSettings={vi.fn()}
          />
          <Probe />
        </ChatTargetProvider>
      </I18nProvider>,
    ));
    const comments: AgentContextDomReviewComment[] = [{
      id: 'review-1',
      text: 'Increase contrast',
      selection: { id: 'dom-1', label: 'Button', nodeId: 'node-1', selector: '#button' },
    }];

    const receipt = await act(async () => broker?.deliver({ kind: 'dom-review', comments }));

    expect(receipt).toMatchObject({ status: 'delivered', target: { surface: 'page' } });
    expect(composer.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Increase contrast'),
      expect.objectContaining({
        scope: 'selected_nodes',
        domSelections: [
          expect.objectContaining({ id: 'existing' }),
          comments[0].selection,
        ],
      }),
    );
    act(() => root.unmount());
  });
});
