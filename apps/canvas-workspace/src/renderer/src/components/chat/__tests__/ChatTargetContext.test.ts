import { describe, expect, it, vi } from 'vitest';
import type { AgentContextDomSelectionRef } from '../../../types';
import {
  createChatTargetBroker,
  type ChatTarget,
} from '../ChatTargetContext';

const dockTarget: ChatTarget = {
  surface: 'dock',
  scope: { kind: 'workspace', workspaceId: 'workspace-a' },
  scopeId: 'workspace-a',
  sessionId: null,
  composerId: 'dock:workspace-a',
  contextSnapshot: {
    label: 'Workspace A',
    requestContext: { scope: 'current_canvas' },
  },
  executionPolicy: 'auto',
};

const pageTarget: ChatTarget = {
  surface: 'page',
  scope: { kind: 'global' },
  scopeId: '__global_chat__',
  sessionId: null,
  composerId: 'page:global',
  contextSnapshot: {
    label: 'Global chat',
  },
  executionPolicy: 'ask',
};

describe('ChatTarget broker', () => {
  it('routes insertions to the visible page target and restores the dock target on exit', async () => {
    const broker = createChatTargetBroker();
    const insertIntoDock = vi.fn();
    const insertIntoPage = vi.fn();

    const unregisterDock = broker.register(dockTarget, {
      insertDomSelection: insertIntoDock,
    });
    expect(broker.getActiveTarget()).toEqual(dockTarget);

    const unregisterPage = broker.register(pageTarget, {
      insertDomSelection: insertIntoPage,
    });
    expect(broker.getActiveTarget()).toEqual(pageTarget);

    const selection: AgentContextDomSelectionRef = {
      id: 'selection-1',
      label: 'Primary action',
      selector: '#primary',
      nodeId: 'link-tab-1',
      workspaceId: 'workspace-a',
    };
    const receipt = await broker.deliver({
      kind: 'dom-selection',
      selection,
    });

    expect(insertIntoPage).toHaveBeenCalledWith(selection);
    expect(insertIntoDock).not.toHaveBeenCalled();
    expect(receipt).toMatchObject({
      status: 'delivered',
      target: {
        surface: 'page',
        scopeId: '__global_chat__',
        composerId: 'page:global',
      },
    });

    unregisterPage();
    expect(broker.getActiveTarget()).toEqual(dockTarget);
    unregisterDock();
    expect(broker.getActiveTarget()).toBeNull();
  });

  it('returns an explicit unavailable receipt instead of claiming an insertion succeeded', async () => {
    const broker = createChatTargetBroker();
    const receipt = await broker.deliver({
      kind: 'dom-selection',
      selection: {
        id: 'selection-1',
        label: 'Primary action',
        selector: '#primary',
        nodeId: 'link-tab-1',
      },
    });

    expect(receipt).toEqual({
      status: 'unavailable',
      target: null,
    });
  });
});
