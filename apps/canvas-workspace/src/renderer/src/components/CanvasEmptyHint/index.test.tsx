// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { CanvasEmptyHint } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CanvasEmptyHint', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('presents the focused workspace loop as three ordered actions', () => {
    act(() => {
      root.render(
        <I18nProvider>
          <CanvasEmptyHint
            onCreateNode={vi.fn()}
            onOpenShortcuts={vi.fn()}
            onSetRootFolder={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    const actions = Array.from(host.querySelectorAll('.canvas-empty-action'));
    expect(actions).toHaveLength(3);
    expect(actions.map((action) => action.textContent)).toEqual([
      expect.stringContaining('Connect a project'),
      expect.stringContaining('Write the brief'),
      expect.stringContaining('Start a coding agent'),
    ]);
    expect(host.textContent).toContain('Build the context your agent can return to');
  });

  it('keeps the example secondary and runs the core actions', () => {
    const onCreateNode = vi.fn();
    const onCreateDemo = vi.fn();
    const onSetRootFolder = vi.fn();
    act(() => {
      root.render(
        <I18nProvider>
          <CanvasEmptyHint
            onCreateNode={onCreateNode}
            onCreateDemo={onCreateDemo}
            onOpenShortcuts={vi.fn()}
            onSetRootFolder={onSetRootFolder}
          />
        </I18nProvider>,
      );
    });

    const buttons = Array.from(host.querySelectorAll('button'));
    act(() => buttons.find((button) => button.textContent?.includes('Connect a project'))?.click());
    act(() => buttons.find((button) => button.textContent?.includes('Write the brief'))?.click());
    act(() => buttons.find((button) => button.textContent?.includes('Start a coding agent'))?.click());
    act(() => buttons.find((button) => button.textContent?.includes('See an example workspace'))?.click());

    expect(onSetRootFolder).toHaveBeenCalledTimes(1);
    expect(onCreateNode).toHaveBeenNthCalledWith(1, 'file');
    expect(onCreateNode).toHaveBeenNthCalledWith(2, 'agent');
    expect(onCreateDemo).toHaveBeenCalledTimes(1);
  });
});
