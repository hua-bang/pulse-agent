// @vitest-environment happy-dom
import { createRef, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../types';
import { ReferenceCanvasNode } from './ReferenceCanvasNode';
import { I18nProvider } from '../../i18n';

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
