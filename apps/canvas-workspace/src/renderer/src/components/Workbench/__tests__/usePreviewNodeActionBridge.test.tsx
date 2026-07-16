// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { dispatchPreviewNodeAction } from '../../../utils/openNodeBridge';
import { usePreviewNodeActionBridge } from '../usePreviewNodeActionBridge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node: CanvasNode = {
  id: 'n1', type: 'text', title: 'Note', x: 0, y: 0, width: 100, height: 80,
  data: { text: 'hello' },
} as CanvasNode;

describe('usePreviewNodeActionBridge', () => {
  let container: HTMLDivElement;
  let root: Root;
  const addPreviewNodeToChat = vi.fn();
  const pinReferenceNode = vi.fn();
  const ensureWorkspaceNodesLoaded = vi.fn();

  const Harness = () => {
    usePreviewNodeActionBridge({
      activeWorkspaceId: 'active-ws',
      addPreviewNodeToChat,
      pinReferenceNode,
      ensureWorkspaceNodesLoaded,
    });
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('routes add-to-chat to the active workspace composer with the source workspace', () => {
    act(() => dispatchPreviewNodeAction({ action: 'add-to-chat', workspaceId: 'preview-ws', node }));
    expect(ensureWorkspaceNodesLoaded).toHaveBeenCalledWith('preview-ws');
    expect(addPreviewNodeToChat).toHaveBeenCalledWith('active-ws', 'preview-ws', node);
    expect(pinReferenceNode).not.toHaveBeenCalled();
  });

  it('routes pin-reference with the node snapshot', () => {
    act(() => dispatchPreviewNodeAction({ action: 'pin-reference', workspaceId: 'preview-ws', node }));
    expect(pinReferenceNode).toHaveBeenCalledWith('preview-ws', 'n1', node);
    expect(addPreviewNodeToChat).not.toHaveBeenCalled();
  });

  it('stops listening after unmount', () => {
    act(() => root.unmount());
    act(() => dispatchPreviewNodeAction({ action: 'add-to-chat', workspaceId: 'preview-ws', node }));
    expect(addPreviewNodeToChat).not.toHaveBeenCalled();
  });
});
