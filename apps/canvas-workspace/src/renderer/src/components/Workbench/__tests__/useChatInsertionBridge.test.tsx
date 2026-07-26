// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentContextDomSelectionRef, CanvasNode } from '../../../types';
import { useChatInsertionBridge } from '../useChatInsertionBridge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useChatInsertionBridge', () => {
  let container: HTMLDivElement;
  let root: Root;
  const openChat = vi.fn();
  let bridge: ReturnType<typeof useChatInsertionBridge>;
  const node: CanvasNode = {
    id: 'node-1',
    type: 'text',
    title: 'Release notes',
    x: 0,
    y: 0,
    width: 240,
    height: 120,
    data: {
      content: 'Ship the bridge fix',
      textColor: '#1f2328',
      backgroundColor: 'transparent',
      fontSize: 18,
      autoSize: true,
    },
  };

  const Harness = () => {
    bridge = useChatInsertionBridge({
      allNodes: { 'workspace-1': [node] },
      openChat,
    });
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('holds a node mention until a composer registers after the opening frame', () => {
    const insert = vi.fn();

    act(() => bridge.handleAddNodeToChat('workspace-1', node.id));
    expect(openChat).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(20));
    expect(insert).not.toHaveBeenCalled();

    act(() => bridge.registerInsertMention('workspace-1', insert));
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(node);

    act(() => vi.advanceTimersByTime(100));
    expect(insert).toHaveBeenCalledOnce();
  });

  it('holds a cross-workspace preview mention until the active composer registers', () => {
    const insert = vi.fn();

    act(() => bridge.handleAddPreviewNodeToChat('workspace-1', 'workspace-2', node));
    expect(openChat).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(20));
    expect(insert).not.toHaveBeenCalled();

    act(() => bridge.registerInsertMention('workspace-1', insert));
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(node, 'workspace-2');

    act(() => vi.advanceTimersByTime(100));
    expect(insert).toHaveBeenCalledOnce();
  });

  it('holds a selection until the workspace composer registers', () => {
    const selection: AgentContextDomSelectionRef = {
      id: 'dom-1',
      label: 'Primary action',
      nodeId: 'link-tab-1',
      selector: '#primary-action',
    };
    const insert = vi.fn();

    act(() => bridge.handleAddDomSelectionToChat('workspace-1', selection));
    expect(openChat).toHaveBeenCalledOnce();
    expect(insert).not.toHaveBeenCalled();

    act(() => bridge.registerInsertDomSelectionMention('workspace-1', insert));
    expect(insert).toHaveBeenCalledWith({ ...selection, workspaceId: 'workspace-1' });
  });
});
