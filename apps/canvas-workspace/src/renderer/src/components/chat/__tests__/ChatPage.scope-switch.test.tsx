// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = vi.hoisted(() => ({ mountCount: 0 }));

vi.mock('../ChatPageBody', async () => {
  const React = await import('react');
  return {
    ChatPageBody: (props: {
      agentScope: { kind: string; workspaceId?: string };
      selectedSessionKey?: string | null;
      onSelectSession: (session: {
        sessionId: string;
        workspaceId: string;
        workspaceName: string;
        date: string;
        messageCount: number;
      }) => void;
    }) => {
      const [mountId] = React.useState(() => ++mockState.mountCount);
      return React.createElement(
        'button',
        {
          'data-mount-id': mountId,
          'data-selected-session': props.selectedSessionKey ?? '',
          onClick: () => props.onSelectSession({
            sessionId: 'session-b',
            workspaceId: 'workspace-b',
            workspaceName: 'Workspace B',
            date: '2026-07-29',
            messageCount: 1,
          }),
        },
        props.agentScope.kind === 'workspace'
          ? props.agentScope.workspaceId
          : props.agentScope.kind,
      );
    },
  };
});

import { ChatPage } from '../ChatPage';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  mockState.mountCount = 0;
});

describe('ChatPage scope switching', () => {
  it('keeps ChatPageBody mounted when selecting a session in another workspace', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <ChatPage
          allWorkspaces={[{ id: 'workspace-b', name: 'Workspace B' }]}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    const body = host.querySelector('button');
    expect(body?.dataset.mountId).toBe('1');
    expect(body?.textContent).toBe('global');

    await act(async () => {
      body?.click();
    });

    const switchedBody = host.querySelector('button');
    expect(switchedBody?.textContent).toBe('workspace-b');
    expect(switchedBody?.dataset.mountId).toBe('1');
    expect(switchedBody?.dataset.selectedSession).toBe('workspace-b:session-b');
    expect(mockState.mountCount).toBe(1);
  });
});
