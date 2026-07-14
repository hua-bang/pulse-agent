// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setCurrentWebview: vi.fn(),
  useEmbeddedBrowser: vi.fn(),
  useManagedWebviewMount: vi.fn(),
}));

vi.mock('../EmbeddedBrowser/useEmbeddedBrowser', () => ({
  useEmbeddedBrowser: mocks.useEmbeddedBrowser,
}));
vi.mock('../IframeNodeBody/useManagedWebviewMount', () => ({
  useManagedWebviewMount: mocks.useManagedWebviewMount,
}));
vi.mock('../../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { LinkTabView } from './index';

beforeEach(() => {
  mocks.setCurrentWebview.mockReset();
  mocks.useManagedWebviewMount.mockReset().mockReturnValue({
    mountUrl: 'https://example.com/runtime',
    setCurrentWebview: mocks.setCurrentWebview,
    shouldMount: false,
    state: 'discarded',
    wake: vi.fn(),
  });
  mocks.useEmbeddedBrowser.mockReset().mockReturnValue({
    canGoBack: false,
    canGoForward: false,
    currentUrl: 'https://example.com/runtime',
    goBack: vi.fn(),
    goForward: vi.fn(),
    hostRef: { current: null },
    loadError: null,
    loadState: 'idle',
    reload: vi.fn(),
    webview: null,
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('LinkTabView WebView residency', () => {
  it('shares the global lifecycle cap and only protects the active dock tab', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => root.render(
      <LinkTabView
        activeWorkspaceId="workspace-1"
        isActive={false}
        residencyId="tab-1"
        url="https://example.com/original"
        onNavigate={() => undefined}
        onRequestClose={() => undefined}
      />,
    ));

    expect(mocks.useManagedWebviewMount).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: true,
      nodeId: 'right-dock:tab-1',
      protectedState: false,
      url: 'https://example.com/original',
    }));
    expect(mocks.useEmbeddedBrowser).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: false,
      url: 'https://example.com/runtime',
    }));

    flushSync(() => root.render(
      <LinkTabView
        activeWorkspaceId="workspace-1"
        isActive
        residencyId="tab-1"
        url="https://example.com/original"
        onNavigate={() => undefined}
        onRequestClose={() => undefined}
      />,
    ));
    expect(mocks.useManagedWebviewMount).toHaveBeenLastCalledWith(expect.objectContaining({
      protectedState: true,
    }));
    flushSync(() => root.unmount());
  });
});
