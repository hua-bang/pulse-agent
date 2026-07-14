// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode, TextNodeData, WorkspaceNodeRecord } from '../../../types';
import { I18nProvider } from '../../../i18n';

const canvasViewState = vi.hoisted(() => ({
  node: null as CanvasNode | null,
  onUpdate: null as ((id: string, patch: Partial<CanvasNode>) => void) | null,
}));

vi.mock('../../CanvasNodeView', () => ({
  CanvasNodeView: ({
    node,
    onUpdate,
  }: {
    node: CanvasNode;
    onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  }) => {
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
});
