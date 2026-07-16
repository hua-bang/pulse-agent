// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { consumePendingPreviewFocus, dispatchPreviewNodeAction } from '../../../utils/openNodeBridge';
import { useEvictAndPreview, usePeekNode, usePreviewNodeActionBridge } from '../usePreviewNodeActionBridge';

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
  const addReferenceToCanvas = vi.fn();
  const ensureWorkspaceNodesLoaded = vi.fn();

  const Harness = () => {
    usePreviewNodeActionBridge({
      activeWorkspaceId: 'active-ws',
      workspaces: [{ id: 'preview-ws', name: 'Preview WS' }],
      addPreviewNodeToChat,
      pinReferenceNode,
      addReferenceToCanvas,
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

  it('routes add-to-canvas as a click-to-place reference entry', () => {
    act(() => dispatchPreviewNodeAction({ action: 'add-to-canvas', workspaceId: 'preview-ws', node }));
    expect(addReferenceToCanvas).toHaveBeenCalledWith({
      kind: 'node',
      workspaceId: 'preview-ws',
      nodeId: 'n1',
      titleSnapshot: 'Note',
      typeSnapshot: 'text',
      workspaceNameSnapshot: 'Preview WS',
    });
    expect(pinReferenceNode).not.toHaveBeenCalled();
  });

  it('stops listening after unmount', () => {
    act(() => root.unmount());
    act(() => dispatchPreviewNodeAction({ action: 'add-to-chat', workspaceId: 'preview-ws', node }));
    expect(addPreviewNodeToChat).not.toHaveBeenCalled();
  });
});

describe('usePeekNode', () => {
  let container: HTMLDivElement;
  let root: Root;
  const openCanvasPreview = vi.fn();
  const onSelectWorkspace = vi.fn();
  const requestNodeFocus = vi.fn();
  let peek: (workspaceId: string, nodeId: string) => void;

  const Harness = () => {
    peek = usePeekNode({
      activeWorkspaceId: 'active-ws',
      workspaces: [{ id: 'other-ws', name: 'Other WS' }],
      openCanvasPreview,
      onSelectWorkspace,
      requestNodeFocus,
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

  it('focuses directly on the main canvas for the active workspace', () => {
    act(() => peek('active-ws', 'n1'));
    expect(requestNodeFocus).toHaveBeenCalledWith('active-ws', 'n1');
    expect(openCanvasPreview).not.toHaveBeenCalled();
  });

  it('opens a dock preview and queues the focus for other workspaces', () => {
    openCanvasPreview.mockReturnValue(true);
    act(() => peek('other-ws', 'n2'));
    expect(openCanvasPreview).toHaveBeenCalledWith('other-ws', 'Other WS');
    expect(consumePendingPreviewFocus('other-ws')).toBe('n2');
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    expect(requestNodeFocus).not.toHaveBeenCalled();
  });

  it('falls back to switching the main canvas when the preview is refused', () => {
    openCanvasPreview.mockReturnValue(false);
    act(() => peek('other-ws', 'n3'));
    expect(onSelectWorkspace).toHaveBeenCalledWith('other-ws');
    expect(requestNodeFocus).toHaveBeenCalledWith('other-ws', 'n3');
  });
});

describe('useEvictAndPreview', () => {
  let container: HTMLDivElement;
  let root: Root;
  const evictWorkspace = vi.fn();
  const openCanvasPreview = vi.fn();

  const Harness = ({ mounted, terminals }: { mounted: string[]; terminals?: Record<string, { tabs: unknown[] }> }) => {
    useEvictAndPreview({
      mountedWorkspaceIds: new Set(mounted),
      evictWorkspace,
      terminalTabsByWorkspace: terminals ?? {},
      openCanvasPreview,
    });
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('evicts, then opens the preview once the workspace is unmounted', () => {
    openCanvasPreview.mockReturnValue(true);
    act(() => root.render(<Harness mounted={['bg-ws']} />));
    act(() => { window.dispatchEvent(new CustomEvent('pulse-canvas:preview-evict-open', { detail: { workspaceId: 'bg-ws', title: 'BG' } })); });
    expect(evictWorkspace).toHaveBeenCalledWith('bg-ws');
    // Still mounted → open not attempted yet.
    expect(openCanvasPreview).not.toHaveBeenCalled();
    // Workbench republishes the shrunken mounted set.
    act(() => root.render(<Harness mounted={[]} />));
    expect(openCanvasPreview).toHaveBeenCalledWith('bg-ws', 'BG');
  });

  it('refuses workspaces with live terminals', () => {
    act(() => root.render(<Harness mounted={['term-ws']} terminals={{ 'term-ws': { tabs: [{}] } }} />));
    act(() => { window.dispatchEvent(new CustomEvent('pulse-canvas:preview-evict-open', { detail: { workspaceId: 'term-ws', title: 'T' } })); });
    expect(evictWorkspace).not.toHaveBeenCalled();
    expect(openCanvasPreview).not.toHaveBeenCalled();
  });
});
