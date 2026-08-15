// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { AppShellProvider } from '../../../shell/AppShellProvider';
import { TabChatAction } from '../TabChatAction';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('TabChatAction', () => {
  it('adds the exact tab ref and announces the real target', async () => {
    const tab = {
      id: 'canvas:source',
      kind: 'canvas' as const,
      title: 'Research canvas',
      workspaceId: 'source',
      dockWorkspaceId: 'active',
    };
    const onAddToChat = vi.fn(async () => ({
      status: 'delivered' as const,
      target: {
        surface: 'page' as const,
        scope: { kind: 'global' as const },
        scopeId: '__global_chat__',
        sessionId: null,
        composerId: 'page:global',
        contextSnapshot: { label: 'Global chat' },
        executionPolicy: 'auto' as const,
      },
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(
      <I18nProvider>
        <AppShellProvider>
          <TabChatAction tab={tab} targetWorkspaceId="active" onAddToChat={onAddToChat} />
        </AppShellProvider>
      </I18nProvider>,
    ));

    const button = host.querySelector<HTMLButtonElement>('button');
    expect(button?.getAttribute('aria-label')).toContain('Research canvas');
    await act(async () => button?.click());

    expect(onAddToChat).toHaveBeenCalledWith('active', tab);
    expect(document.body.textContent).toContain('Added to AI Chat');
  });
});
