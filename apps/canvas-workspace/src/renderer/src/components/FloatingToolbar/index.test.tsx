// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { FloatingToolbar } from './index';

vi.mock('../RightDock', () => ({
  useRightDock: () => ({
    toggleTerminal: vi.fn(),
    newTerminal: vi.fn(),
  }),
  useRightDockState: () => ({
    expanded: false,
    terminalTabs: [],
    activeTabId: null,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: undefined,
  });
  root = null;
  host = null;
});

describe('FloatingToolbar', () => {
  it('hides optional creation tools while keeping terminal and mindmap visible', async () => {
    const list = vi.fn().mockResolvedValue({
      ok: true,
      status: {
        path: '/tmp/canvas-plugins.json',
        pluginDirs: ['/tmp/canvas-plugin'],
        plugins: [{
          id: 'demo-plugin',
          dir: '/tmp/canvas-plugin',
          manifestPath: '/tmp/canvas-plugin/manifest.json',
          nodes: [{ type: 'demo.widget', title: 'Demo Widget' }],
          rendererSpecs: [],
        }],
        rendererSpecs: [],
      },
    });
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { canvasPlugins: { list } },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <FloatingToolbar
            activeTool="select"
            onToolChange={vi.fn()}
            onAddNode={vi.fn()}
            onCreateAgentTeam={vi.fn()}
            chatPanelOpen={false}
            onChatToggle={vi.fn()}
            referenceDrawerOpen={false}
            onReferenceToggle={vi.fn()}
          />
        </I18nProvider>,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(list).not.toHaveBeenCalled();
    expect(host.querySelector('.shape-tool-split')).toBeNull();
    expect(host.querySelector('button[data-tooltip="Plugin"]')).toBeNull();
    expect(host.querySelector('button[data-tooltip="Team"]')).toBeNull();
    expect(host.querySelector('.terminal-tool-split')).not.toBeNull();
    expect(host.querySelector('button[data-tooltip="Mindmap"]')).not.toBeNull();
  });
});
