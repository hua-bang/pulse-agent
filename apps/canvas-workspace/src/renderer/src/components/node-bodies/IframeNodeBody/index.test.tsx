// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../shell/AppShellProvider';
import type { AgentContextDomSelectionRef, CanvasNode } from '../../../types';
import { IframeNodeBody } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  addDomSelectionToChat: vi.fn(),
  pickDomElement: vi.fn(),
}));

vi.mock('../../dock/RightDock', () => ({
  useRightDock: () => ({
    openArtifact: vi.fn(),
    addDomSelectionToChat: mocks.addDomSelectionToChat,
  }),
}));

vi.mock('./useIframeNodeState', () => ({
  useIframeNodeState: () => ({
    editing: false,
    mode: 'url',
    pickDomElement: mocks.pickDomElement,
  }),
}));

vi.mock('./IframeRenderedView', () => ({
  IframeRenderedView: ({ handlePickDomElement }: { handlePickDomElement: () => void }) => (
    <button type="button" onClick={handlePickDomElement}>Pick element</button>
  ),
}));

vi.mock('./IframeReviewLayer', () => ({ IframeReviewLayer: () => null }));
vi.mock('./IframeEditor', () => ({ IframeEditor: () => null }));

const node = {
  id: 'iframe-1',
  type: 'iframe',
  title: 'Example page',
  x: 0,
  y: 0,
  width: 320,
  height: 240,
  data: { mode: 'url', url: 'https://example.com' },
} as CanvasNode;

const selection: AgentContextDomSelectionRef = {
  id: 'selection-1',
  label: 'Primary action',
  selector: '#primary',
  nodeId: node.id,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const render = async (onAddDomSelectionToChat?: (
  value: AgentContextDomSelectionRef,
) => Promise<{
  status: 'queued';
  target: {
    surface: 'page';
    scope: { kind: 'global' };
    scopeId: string;
    sessionId: null;
    composerId: string;
    contextSnapshot: { label: string };
    executionPolicy: 'auto';
  };
}>) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(
    <I18nProvider>
      <AppShellProvider>
        <IframeNodeBody
          node={node}
          workspaceId="workspace-a"
          onUpdate={() => undefined}
          onAddDomSelectionToChat={onAddDomSelectionToChat}
        />
      </AppShellProvider>
    </I18nProvider>,
  ));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pickDomElement.mockResolvedValue({ ok: true, selection });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('IframeNodeBody DOM selection delivery', () => {
  it('reports unavailable when no chat insertion handler is registered', async () => {
    mocks.addDomSelectionToChat.mockResolvedValue({ status: 'unavailable', target: null });
    await render();

    await act(async () => host?.querySelector<HTMLButtonElement>('button')?.click());

    expect(mocks.addDomSelectionToChat).toHaveBeenCalledWith('workspace-a', expect.objectContaining({
      id: selection.id,
      nodeId: node.id,
      workspaceId: 'workspace-a',
    }));
    expect(document.body.textContent).toContain('No AI Chat is available');
    expect(document.body.textContent).not.toContain('DOM selection added');
  });

  it('shows queued delivery against the actual target', async () => {
    const onAddDomSelectionToChat = vi.fn(async () => ({
      status: 'queued' as const,
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
    await render(onAddDomSelectionToChat);

    await act(async () => host?.querySelector<HTMLButtonElement>('button')?.click());

    expect(onAddDomSelectionToChat).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('Queued for Global chat');
  });
});
