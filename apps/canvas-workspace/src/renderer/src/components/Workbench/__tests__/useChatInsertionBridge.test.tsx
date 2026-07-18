// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentContextDomSelectionRef } from '../../../types';
import { useChatInsertionBridge } from '../useChatInsertionBridge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useChatInsertionBridge DOM selections', () => {
  let container: HTMLDivElement;
  let root: Root;
  const openChat = vi.fn();
  let bridge: ReturnType<typeof useChatInsertionBridge>;

  const Harness = () => {
    bridge = useChatInsertionBridge({ allNodes: {}, openChat });
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
