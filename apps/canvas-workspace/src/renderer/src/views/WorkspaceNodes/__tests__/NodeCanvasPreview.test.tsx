// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode, TextNodeData, WorkspaceNodeRecord } from '../../../types';
import { I18nProvider } from '../../../i18n';

const canvasViewState = vi.hoisted(() => ({
  hideHeader: false,
  isSelected: false,
  node: null as CanvasNode | null,
  onUpdate: null as ((id: string, patch: Partial<CanvasNode>) => void) | null,
}));

vi.mock('../../../components/canvas/CanvasNodeView', () => ({
  CanvasNodeView: ({
    node,
    onUpdate,
    hideHeader,
    isSelected,
  }: {
    node: CanvasNode;
    onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
    hideHeader?: boolean;
    isSelected?: boolean;
  }) => {
    canvasViewState.hideHeader = Boolean(hideHeader);
    canvasViewState.isSelected = Boolean(isSelected);
    canvasViewState.node = node;
    canvasViewState.onUpdate = onUpdate;
    return <div data-testid="canvas-node" data-content={(node.data as { content?: string }).content ?? ''} />;
  },
}));

import { NodeCanvasPreview } from '../NodeCanvasPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NODE: WorkspaceNodeRecord = {
  schemaVersion: 1,
  id: 'node-1',
  type: 'text',
  title: 'Draft',
  data: { content: 'zero' },
  updatedAt: 1,
};

const textNodeData = (content: string): TextNodeData => ({
  content,
  textColor: '#2f2d2a',
  backgroundColor: 'transparent',
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  canvasViewState.node = null;
  canvasViewState.onUpdate = null;
  canvasViewState.hideHeader = false;
  canvasViewState.isSelected = false;
  Reflect.deleteProperty(window, 'canvasWorkspace');
});

const render = (node: ReactNode) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<I18nProvider>{node}</I18nProvider>);
  });
  return host;
};

describe('NodeCanvasPreview', () => {
  it('renders only the body when the surrounding detail document owns the title', () => {
    render(<NodeCanvasPreview workspaceId="workspace-1" record={NODE} />);

    expect(canvasViewState.hideHeader).toBe(true);
  });

  it('restores the web chrome through a semantic presentation class', () => {
    const view = render(
      <NodeCanvasPreview
        workspaceId="workspace-1"
        record={{ ...NODE, type: 'iframe', data: { mode: 'url', url: 'https://example.com' } }}
      />,
    );

    expect(view.querySelector('.node-canvas-preview--web')).not.toBeNull();
    expect(canvasViewState.isSelected).toBe(false);
  });

  it('selects mindmaps so their original topic interactions remain available', () => {
    const view = render(
      <NodeCanvasPreview workspaceId="workspace-1" record={{ ...NODE, type: 'mindmap', data: {} }} />,
    );

    expect(view.querySelector('.node-canvas-preview--mindmap')).not.toBeNull();
    expect(canvasViewState.isSelected).toBe(true);
  });

  it('pans a mindmap by dragging its non-interactive background with a pointer', () => {
    const view = render(
      <NodeCanvasPreview workspaceId="workspace-1" record={{ ...NODE, type: 'mindmap', data: {} }} />,
    );
    const preview = view.querySelector<HTMLElement>('.node-canvas-preview--mindmap');
    if (!preview) throw new Error('Expected mindmap presentation');
    preview.scrollLeft = 100;
    preview.scrollTop = 80;

    act(() => {
      preview.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 7,
        clientX: 60,
        clientY: 50,
      }));
      preview.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 7,
        clientX: 20,
        clientY: 10,
      }));
    });

    expect(preview.scrollLeft).toBe(140);
    expect(preview.scrollTop).toBe(120);
    expect(preview.classList.contains('is-panning')).toBe(true);

    act(() => { preview.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 })); });
    expect(preview.classList.contains('is-panning')).toBe(false);
  });

  it('exposes a focusable mindmap viewport that pans with the arrow keys', () => {
    const view = render(
      <NodeCanvasPreview workspaceId="workspace-1" record={{ ...NODE, type: 'mindmap', data: {} }} />,
    );
    const preview = view.querySelector<HTMLElement>('.node-canvas-preview--mindmap');
    if (!preview) throw new Error('Expected mindmap presentation');
    preview.scrollLeft = 100;
    preview.scrollTop = 80;

    act(() => {
      preview.focus();
      preview.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
      preview.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    });

    expect(preview.tabIndex).toBe(0);
    expect(preview.scrollLeft).toBe(140);
    expect(preview.scrollTop).toBe(120);
    expect(view.querySelector<HTMLButtonElement>('[aria-label="Center mindmap"]')).not.toBeNull();
  });

  it('keeps the latest local draft when an older update acknowledgement arrives', async () => {
    const resolvers: Array<(result: unknown) => void> = [];
    const update = vi.fn(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const read = vi.fn(async () => ({ ok: true, node: NODE }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { update, read } },
    });
    const onPatched = vi.fn();
    const view = render(
      <NodeCanvasPreview workspaceId="workspace-1" record={NODE} onPatched={onPatched} />,
    );
    const sendUpdate = canvasViewState.onUpdate;
    if (!sendUpdate) throw new Error('Expected the CanvasNodeView update callback');

    act(() => {
      sendUpdate('node-1', { data: textNodeData('one') });
      sendUpdate('node-1', { data: textNodeData('two') });
    });
    expect(view.querySelector('[data-testid="canvas-node"]')?.getAttribute('data-content')).toBe('two');

    await act(async () => {
      resolvers[0]?.({ ok: true, node: { ...NODE, data: { content: 'one' }, updatedAt: 2 } });
      await Promise.resolve();
    });
    expect(view.querySelector('[data-testid="canvas-node"]')?.getAttribute('data-content')).toBe('two');
    expect(onPatched).not.toHaveBeenCalled();

    await act(async () => {
      resolvers[1]?.({ ok: true, node: { ...NODE, data: { content: 'two' }, updatedAt: 3 } });
      await Promise.resolve();
    });
    expect(view.querySelector('[data-testid="canvas-node"]')?.getAttribute('data-content')).toBe('two');
    expect(onPatched).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { content: 'two' },
      updatedAt: 3,
    }));
  });

  // Node bodies call onUpdate fire-and-forget (the canvas's own onUpdate never
  // rejects), so a rejected save reached nobody: the edit was replaced by the
  // stored record and the rejection surfaced only as an unhandled promise.
  it('keeps unsaved content on screen when a save fails, and retries it', async () => {
    const update = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'disk full' })
      .mockResolvedValueOnce({ ok: true, node: { ...NODE, data: { content: 'one' }, updatedAt: 4 } });
    const read = vi.fn(async () => ({ ok: true, node: NODE }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { update, read } },
    });
    const onPatched = vi.fn();
    const view = render(
      <NodeCanvasPreview workspaceId="workspace-1" record={NODE} onPatched={onPatched} />,
    );
    const sendUpdate = canvasViewState.onUpdate;
    if (!sendUpdate) throw new Error('Expected the CanvasNodeView update callback');

    await act(async () => {
      sendUpdate('node-1', { data: textNodeData('one') });
      await Promise.resolve();
    });

    expect(view.querySelector('[data-testid="canvas-node"]')?.getAttribute('data-content')).toBe('one');
    expect(read).not.toHaveBeenCalled();
    const banner = view.querySelector('.node-canvas-preview__save-error');
    expect(banner).not.toBeNull();

    const retry = Array.from(banner?.querySelectorAll('button') ?? [])[0];
    if (!retry) throw new Error('Expected a retry button');
    await act(async () => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(update).toHaveBeenLastCalledWith('workspace-1', 'node-1', { data: textNodeData('one') });
    expect(view.querySelector('.node-canvas-preview__save-error')).toBeNull();
    expect(onPatched).toHaveBeenLastCalledWith(expect.objectContaining({ updatedAt: 4 }));
  });

  it('does not let an external record overwrite content that failed to save', async () => {
    const update = vi.fn(async () => ({ ok: false, error: 'disk full' }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { update, read: vi.fn() } },
    });
    const view = render(<NodeCanvasPreview workspaceId="workspace-1" record={NODE} />);
    const sendUpdate = canvasViewState.onUpdate;
    if (!sendUpdate) throw new Error('Expected the CanvasNodeView update callback');

    await act(async () => {
      sendUpdate('node-1', { data: textNodeData('local edit') });
      await Promise.resolve();
    });
    // A workspace-node change broadcast lands while the failed edit is held.
    await act(async () => {
      root?.render(
        <I18nProvider>
          <NodeCanvasPreview
            workspaceId="workspace-1"
            record={{ ...NODE, data: { content: 'stored' }, updatedAt: 9 }}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
    });

    expect(view.querySelector('[data-testid="canvas-node"]')?.getAttribute('data-content')).toBe('local edit');
  });

  it('never rejects into the node body that fired the update', async () => {
    const update = vi.fn(async () => ({ ok: false, error: 'disk full' }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { update, read: vi.fn() } },
    });
    render(<NodeCanvasPreview workspaceId="workspace-1" record={NODE} />);
    const sendUpdate = canvasViewState.onUpdate;
    if (!sendUpdate) throw new Error('Expected the CanvasNodeView update callback');

    // Exactly how TextNodeBody/MindmapNodeBody/IframeNodeBody call it: no
    // await, no catch. This must not produce an unhandled rejection.
    await act(async () => {
      const returned = sendUpdate('node-1', { data: textNodeData('one') }) as unknown;
      await expect(Promise.resolve(returned)).resolves.toBeUndefined();
    });
  });
});
