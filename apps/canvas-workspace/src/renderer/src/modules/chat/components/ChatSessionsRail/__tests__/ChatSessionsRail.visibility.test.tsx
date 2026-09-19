// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { ChatSessionsRail, type UnifiedSession } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (workspaceId: string): UnifiedSession => ({
  workspaceId,
  workspaceName: workspaceId,
  sessionId: `${workspaceId}-session`,
  date: '2026-09-19',
  messageCount: 1,
  preview: `${workspaceId} conversation`,
});

describe('ChatSessionsRail workspace visibility', () => {
  it('does not recreate absent workspaces from history, including while searching', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const allSessions = [
      session('visible'),
      session('filtered'),
      session('__scheduled__-memory-report'),
      session('__global_chat__'),
    ];
    const render = (workspaces: { id: string; name: string }[]) => act(() => root.render(
      <I18nProvider>
        <ChatSessionsRail
          allSessions={allSessions}
          workspaces={workspaces}
          onNewSession={vi.fn()}
          onSelectSession={vi.fn()}
        />
      </I18nProvider>,
    ));
    try {
      render([{ id: 'visible', name: 'Visible workspace' }]);
      expect(host.querySelectorAll('.chat-page-rail-folder-name')).toHaveLength(1);
      expect(host.textContent).toContain('Visible workspace');
      expect(host.textContent).not.toContain('filtered');
      expect(host.textContent).not.toContain('__scheduled__-memory-report');
      expect(host.textContent).toContain('__global_chat__ conversation');

      const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'filtered');
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(host.querySelectorAll('.chat-page-rail-folder-name')).toHaveLength(0);
      expect(host.textContent).not.toContain('filtered conversation');
    } finally {
      act(() => root.unmount());
    }
  });

  it('reconciles removed workspaces without deleting history and preserves global chat for an empty list', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const allSessions = [session('visible'), session('__global_chat__')];
    const render = (workspaces: { id: string; name: string }[]) => act(() => root.render(
      <I18nProvider>
        <ChatSessionsRail
          allSessions={allSessions}
          workspaces={workspaces}
          onNewSession={vi.fn()}
          onSelectSession={vi.fn()}
        />
      </I18nProvider>,
    ));
    try {
      render([{ id: 'visible', name: 'Visible workspace' }]);
      expect(host.querySelectorAll('.chat-page-rail-folder-name')).toHaveLength(1);
      render([]);
      expect(host.querySelectorAll('.chat-page-rail-folder-name')).toHaveLength(0);
      expect(host.textContent).toContain('__global_chat__ conversation');
      expect(allSessions).toHaveLength(2);
      render([{ id: 'visible', name: 'Visible workspace' }]);
      expect(host.querySelectorAll('.chat-page-rail-folder-name')).toHaveLength(1);
    } finally {
      act(() => root.unmount());
    }
  });
});
