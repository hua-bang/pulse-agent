// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, CanvasNode } from '../../../../types';
import type { ChatTargetBroker } from '../../../chat/ChatTargetContext';
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

    act(() => { void bridge.handleAddNodeToChat('workspace-1', node.id); });
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

    act(() => { void bridge.handleAddPreviewNodeToChat('workspace-1', 'workspace-2', node); });
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

    act(() => { void bridge.handleAddDomSelectionToChat('workspace-1', selection); });
    expect(openChat).toHaveBeenCalledOnce();
    expect(insert).not.toHaveBeenCalled();

    act(() => bridge.registerInsertDomSelectionMention('workspace-1', insert));
    expect(insert).toHaveBeenCalledWith({ ...selection, workspaceId: 'workspace-1' });
  });

  it('holds DOM review submission until a cold composer actually registers', async () => {
    const comments: AgentContextDomReviewComment[] = [{
      id: 'comment-1',
      text: 'Increase contrast',
      selection: {
        id: 'dom-1',
        label: 'Primary action',
        nodeId: 'link-tab-1',
        selector: '#primary-action',
      },
    }];
    const submit = vi.fn(async () => true);
    let result: boolean | undefined;

    act(() => {
      void bridge.handleSubmitDomReviewComments('workspace-1', comments)
        .then(value => { result = value; });
    });
    expect(openChat).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(100));
    expect(result).toBeUndefined();
    expect(submit).not.toHaveBeenCalled();

    await act(async () => {
      bridge.registerSubmitDomReviewComments('workspace-1', submit);
      await Promise.resolve();
    });
    expect(submit).toHaveBeenCalledWith(comments);
    expect(result).toBe(true);
  });

  it('holds a new Skill chat request until the workspace composer registers', async () => {
    const startSkillChat = vi.fn().mockResolvedValue(undefined);

    act(() => { void bridge.handleStartSkillChat('workspace-1', 'release-canvas'); });
    expect(openChat).toHaveBeenCalledOnce();
    expect(startSkillChat).not.toHaveBeenCalled();

    act(() => bridge.registerStartSkillChat('workspace-1', startSkillChat));
    await act(async () => Promise.resolve());
    expect(startSkillChat).toHaveBeenCalledWith('release-canvas');
  });

  it('keeps only the latest Skill chat request queued before the composer registers', async () => {
    const startSkillChat = vi.fn().mockResolvedValue(undefined);

    act(() => {
      void bridge.handleStartSkillChat('workspace-1', 'first-skill');
      void bridge.handleStartSkillChat('workspace-1', 'second-skill');
      bridge.registerStartSkillChat('workspace-1', startSkillChat);
    });
    await act(async () => Promise.resolve());
    expect(startSkillChat).toHaveBeenCalledTimes(1);
    expect(startSkillChat).toHaveBeenCalledWith('second-skill');
  });

  it('focuses chat after an already mounted composer finishes starting the session', async () => {
    let finish: (() => void) | undefined;
    const startSkillChat = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));

    act(() => bridge.registerStartSkillChat('workspace-1', startSkillChat));
    act(() => { void bridge.handleStartSkillChat('workspace-1', 'memory-review'); });
    expect(startSkillChat).toHaveBeenCalledWith('memory-review');
    expect(openChat).not.toHaveBeenCalled();

    await act(async () => {
      finish?.();
      await Promise.resolve();
    });
    expect(openChat).toHaveBeenCalledOnce();
  });

  it('delivers a page selection to the visible target instead of mutating a hidden dock composer', async () => {
    const insertSelection = vi.fn();
    const deliver: ChatTargetBroker['deliver'] = vi.fn(async (insertion) => {
      if (insertion.kind === 'dom-selection') insertSelection(insertion.selection);
      return {
        status: 'delivered' as const,
        target: {
          surface: 'page' as const,
          scope: { kind: 'global' as const },
          scopeId: '__global_chat__',
          sessionId: null,
          composerId: 'page:global',
          contextSnapshot: { label: 'Global chat' },
          executionPolicy: 'auto' as const,
        },
      };
    });
    act(() => root.unmount());
    const TargetHarness = () => {
      bridge = useChatInsertionBridge({
        allNodes: { 'workspace-1': [node] },
        openChat,
        deliverToActiveTarget: deliver,
      });
      return null;
    };
    root = createRoot(container);
    act(() => root.render(<TargetHarness />));
    const selection: AgentContextDomSelectionRef = {
      id: 'dom-1',
      label: 'Primary action',
      nodeId: 'link-tab-1',
      selector: '#primary-action',
    };

    let receipt;
    await act(async () => {
      receipt = await bridge.handleAddDomSelectionToChat('workspace-1', selection);
    });

    expect(insertSelection).toHaveBeenCalledWith({
      ...selection,
      workspaceId: 'workspace-1',
    });
    expect(openChat).not.toHaveBeenCalled();
    expect(receipt).toMatchObject({
      status: 'delivered',
      target: { composerId: 'page:global' },
    });
  });

  it('falls back when the visible target does not support that insertion kind', async () => {
    const deliver: ChatTargetBroker['deliver'] = vi.fn(async () => ({
      status: 'unavailable' as const,
      target: {
        surface: 'page' as const,
        scope: { kind: 'global' as const },
        scopeId: '__global_chat__',
        sessionId: null,
        composerId: 'page:global',
        contextSnapshot: { label: 'Global chat' },
        executionPolicy: 'auto' as const,
      },
    }));
    act(() => root.unmount());
    const TargetHarness = () => {
      bridge = useChatInsertionBridge({
        allNodes: { 'workspace-1': [node] },
        openChat,
        deliverToActiveTarget: deliver,
      });
      return null;
    };
    root = createRoot(container);
    act(() => root.render(<TargetHarness />));
    const insert = vi.fn();
    act(() => bridge.registerInsertMention('workspace-1', insert));

    let receipt;
    await act(async () => {
      receipt = await bridge.handleAddNodeToChat('workspace-1', node.id);
    });

    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ kind: 'node' }));
    expect(insert).toHaveBeenCalledWith(node);
    expect(openChat).toHaveBeenCalledOnce();
    expect(receipt).toMatchObject({
      status: 'delivered',
      target: {
        composerId: 'dock:workspace-1',
        scopeId: 'workspace-1',
      },
    });
  });
});
