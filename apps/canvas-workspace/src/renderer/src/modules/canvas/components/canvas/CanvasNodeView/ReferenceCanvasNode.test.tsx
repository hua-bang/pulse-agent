// @vitest-environment happy-dom
import { createRef, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { CanvasNode } from '../../../../../types';
import { ReferenceCanvasNode } from './ReferenceCanvasNode';

const referenceNode: CanvasNode = {
  id: 'ref-1',
  type: 'reference',
  title: 'Pinned source',
  x: 10,
  y: 20,
  width: 320,
  height: 220,
  ref: {
    kind: 'workspace-node',
    workspaceId: 'workspace-2',
    nodeId: 'source-1',
  },
  data: {
    titleSnapshot: 'Source note',
    typeSnapshot: 'text',
    workspaceNameSnapshot: 'Research',
  },
};

const sourceNode: CanvasNode = {
  id: 'source-1',
  type: 'text',
  title: 'Source note',
  x: 0,
  y: 0,
  width: 260,
  height: 140,
  data: {
    content: 'Reference preview',
    textColor: '#111827',
    backgroundColor: '#ffffff',
  },
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    root.unmount();
  }
  host?.remove();
  root = null;
  host = null;
});

describe('ReferenceCanvasNode', () => {
  it('keeps clicks in selected reference content away from the drag target', () => {
    const handleHeaderMouseDown = vi.fn();
    const handleNodeBodyMouseDown = vi.fn((e: MouseEvent) => e.stopPropagation());

    renderReferenceNode({
      handleHeaderMouseDown,
      handleNodeBodyMouseDown,
      isSelected: true,
    });

    const source = host?.querySelector('[data-testid="reference-source"]');
    expect(source).toBeInstanceOf(HTMLElement);
    expect(host?.querySelector('.node-body--reference > .reference-drag-handle')).toBeNull();

    source?.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true, button: 0 }));

    expect(handleNodeBodyMouseDown).toHaveBeenCalledTimes(1);
    expect(handleHeaderMouseDown).not.toHaveBeenCalled();
  });

  it('keeps the drag handle active even before selection', () => {
    const handleHeaderMouseDown = vi.fn();

    renderReferenceNode({
      handleHeaderMouseDown,
      isSelected: false,
    });

    const dragHandle = host?.querySelector('.reference-drag-handle');
    expect(dragHandle).toBeInstanceOf(HTMLElement);

    dragHandle?.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true, button: 0 }));

    expect(handleHeaderMouseDown).toHaveBeenCalledTimes(1);
  });

  it('routes AI, fullscreen and focus through the outer reference actions', () => {
    const handleAddToChat = vi.fn(), handleToggleFullscreen = vi.fn(), handleFocus = vi.fn();
    renderReferenceNode({ handleAddToChat, handleToggleFullscreen, handleFocus });
    for (const label of ['Add node to AI chat', 'Enter fullscreen', 'Focus node']) {
      (host?.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click();
    }
    expect(handleAddToChat).toHaveBeenCalledTimes(1);
    expect(handleToggleFullscreen).toHaveBeenCalledTimes(1);
    expect(handleFocus).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('button[aria-label="Open source"]')).not.toBeNull();
  });

  it('previews a whole canvas read-only from its live nodes and opens it on double-click', async () => {
    const handleOpenReferenceSource = vi.fn();
    const canvasReference: CanvasNode = {
      ...referenceNode, title: 'Research', ref: { kind: 'workspace', workspaceId: 'workspace-2' },
      data: { workspaceNameSnapshot: 'Research' },
    };
    renderReferenceNode({
      node: canvasReference,
      handleOpenReferenceSource,
      resolved: { workspaceName: 'Research', workspaceNodes: [sourceNode, { ...sourceNode, id: 'two', x: 300 }] },
    });
    expect(host?.querySelector('[data-testid="reference-source"]')).toBeNull();
    await vi.waitFor(() => expect(host?.querySelectorAll('.workspace-reference__box')).toHaveLength(2));
    expect(host?.querySelector('.workspace-reference__meta')?.textContent).toBe('2 cards');
    expect(host?.querySelector('.workspace-reference__badge')?.textContent).toBe('Read-only');
    expect((host?.querySelector('button[aria-label="Open source"]') as HTMLButtonElement).disabled).toBe(false);
    host?.querySelector('.workspace-reference')?.dispatchEvent(new globalThis.MouseEvent('dblclick', { bubbles: true }));
    expect(handleOpenReferenceSource).toHaveBeenCalledTimes(1);
  });

  it('draws text nodes as their first line and frames with their name', async () => {
    const canvasReference: CanvasNode = {
      ...referenceNode, ref: { kind: 'workspace', workspaceId: 'workspace-2' }, data: { workspaceNameSnapshot: 'Research' },
    };
    const frame: CanvasNode = { ...sourceNode, id: 'frame', type: 'frame', title: '宏观层面', width: 600, height: 400, data: {} };
    const text: CanvasNode = {
      ...sourceNode, id: 'text', title: 'Text', x: 20, y: 20, width: 500, height: 12,
      data: { ...sourceNode.data, content: '<p>当前策略：找 5 个人聊天</p><p>more</p>' } as CanvasNode['data'],
    };
    const empty: CanvasNode = { ...text, id: 'empty', y: 200, data: { ...sourceNode.data, content: '' } as CanvasNode['data'] };
    renderReferenceNode({
      node: canvasReference,
      resolved: { workspaceName: 'Research', workspaceNodes: [frame, text, empty] },
    });
    await vi.waitFor(() => expect(host?.querySelectorAll('.workspace-reference__box')).toHaveLength(3));
    expect(host?.querySelector('.workspace-reference__frame-title')?.textContent).toBe('宏观层面');
    const textBoxes = host?.querySelectorAll('.workspace-reference__box[data-type="text"]');
    expect(textBoxes?.[0].textContent).toBe('当前策略：找 5 个人聊天');
    expect(textBoxes?.[1].querySelector('.workspace-reference__line')).not.toBeNull();
  });

  it('shows a deleted canvas reference as deleted and cannot open it', async () => {
    renderReferenceNode({
      node: { ...referenceNode, ref: { kind: 'workspace', workspaceId: 'gone' }, data: { workspaceNameSnapshot: 'Old plan' } },
      resolved: {},
    });
    await vi.waitFor(() => expect(host?.querySelector('.workspace-reference__empty')?.textContent).toBe('This canvas was deleted'));
    expect(host?.querySelector('.workspace-reference__name')?.textContent).toBe('Old plan');
    expect((host?.querySelector('button[aria-label="Open source"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('announces title editing as a single-line text box', () => {
    renderReferenceNode({ isEditingTitle: true });

    const title = host?.querySelector('[role="textbox"]');
    expect(title?.getAttribute('aria-label')).toBe('Edit node title');
    expect(title?.getAttribute('aria-multiline')).toBe('false');
  });
});

function renderReferenceNode(overrides: Partial<Parameters<typeof ReferenceCanvasNode>[0]> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  flushSync(() => {
    root?.render(
      <I18nProvider>
        <ReferenceCanvasNode
          classes="canvas-node canvas-node--reference"
          handleClose={vi.fn()}
          handleHeaderMouseDown={vi.fn()}
          handleNodeBodyMouseDown={vi.fn()}
          handleNodeClick={vi.fn()}
          handleOpenReferenceSource={vi.fn()}
          handleTitleBlur={vi.fn()}
          handleTitleDoubleClick={vi.fn()}
          handleTitleKeyDown={vi.fn()}
          isEditingTitle={false}
          isFullscreen={false}
          isSelected={false}
          makeResizeHandler={() => vi.fn()}
          node={referenceNode}
          readOnly={false}
          renderReferenceSource={() => <div data-testid="reference-source">Source</div>}
          resolved={{ node: sourceNode, workspaceName: 'Research' }}
          titleRef={createRef<HTMLSpanElement>()}
          wrapperStyle={{}}
          {...overrides}
        />
      </I18nProvider>,
    );
  });
}
