// @vitest-environment happy-dom
import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../types';
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
  it('keeps a drag target available while the reference preview is selected', () => {
    const handleHeaderMouseDown = vi.fn();

    renderReferenceNode({
      handleHeaderMouseDown,
      isSelected: true,
    });

    const dragHandle = host?.querySelector('.reference-drag-handle');
    expect(dragHandle).toBeInstanceOf(HTMLElement);
    expect(host?.querySelector('.reference-drag-overlay')).toBeNull();

    dragHandle?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));

    expect(handleHeaderMouseDown).toHaveBeenCalledTimes(1);
  });
});

function renderReferenceNode(overrides: Partial<Parameters<typeof ReferenceCanvasNode>[0]> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  flushSync(() => {
    root?.render(
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
      />,
    );
  });
}
