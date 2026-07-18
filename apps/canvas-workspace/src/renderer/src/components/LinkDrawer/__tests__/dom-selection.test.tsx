// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShellProvider } from '../../AppShellProvider';
import { I18nProvider } from '../../../i18n';
import { LinkTabView } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pickDomElement = vi.fn();

vi.mock('../../EmbeddedBrowser/useEmbeddedBrowser', () => ({
  useEmbeddedBrowser: () => ({
    canGoBack: false,
    canGoForward: false,
    currentUrl: 'https://example.com/page',
    goBack: vi.fn(),
    goForward: vi.fn(),
    hostRef: vi.fn(),
    loadState: 'ready',
    reload: vi.fn(),
    webview: null,
  }),
}));

vi.mock('../../IframeNodeBody/useWebviewRegistration', () => ({
  useWebviewRegistration: vi.fn(),
}));

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

beforeEach(() => {
  pickDomElement.mockReset();
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      history: { query: vi.fn().mockResolvedValue([]), record: vi.fn() },
      iframe: { pickDomElement },
      pluginFlags: {},
      shell: { openExternal: vi.fn() },
    },
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
  vi.restoreAllMocks();
});

describe('LinkTabView DOM selection', () => {
  it('lets the user select a page element and adds it to the active workspace chat', async () => {
    const onAddDomSelectionToChat = vi.fn();
    pickDomElement.mockResolvedValue({
      ok: true,
      selection: {
        id: 'dom-1',
        label: 'Primary action',
        nodeId: 'stale-source',
        selector: '#primary-action',
      },
    });
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);

    await act(async () => root?.render(
      <I18nProvider>
        <AppShellProvider>
          <LinkTabView
            url="https://example.com/page"
            title="Example page"
            tabId="link-tab-1"
            activeWorkspaceId="workspace-1"
            onNavigate={() => undefined}
            onGuestNavigate={() => undefined}
            onAddToReference={() => undefined}
            onAddDomSelectionToChat={onAddDomSelectionToChat}
            onRequestClose={() => undefined}
          />
        </AppShellProvider>
      </I18nProvider>,
    ));

    const button = mount.querySelector<HTMLButtonElement>('[aria-label="Select page element for AI Chat"]');
    expect(button).not.toBeNull();
    await act(async () => button?.click());

    expect(pickDomElement).toHaveBeenCalledWith('workspace-1', 'link-tab-1');
    expect(onAddDomSelectionToChat).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dom-1',
      workspaceId: 'workspace-1',
      nodeId: 'link-tab-1',
      nodeTitle: 'Example page',
      url: 'https://example.com/page',
      selector: '#primary-action',
    }));
  });
});
