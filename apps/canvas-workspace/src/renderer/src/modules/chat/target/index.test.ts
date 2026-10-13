import { describe, expect, it, vi } from 'vitest';
import type { AgentContextDomSelectionRef, AgentContextTabRef } from '../../../types';
import {
  createChatTargetBroker,
  type ChatTarget,
} from './index';

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

  it('submits a prompt to the active composer and reports a refused send as failed', async () => {
    const broker = createChatTargetBroker();
    const submitPrompt = vi.fn(async () => true);
    broker.register(dockTarget, { submitPrompt });
    const prompt = { text: 'Which tier?', nodes: [{ id: 'node-1', title: 'Research', type: 'text' as const }] };

    expect(await broker.deliver({ kind: 'prompt', prompt })).toMatchObject({ status: 'delivered' });
    expect(submitPrompt).toHaveBeenCalledWith(prompt);

    submitPrompt.mockResolvedValueOnce(false);
    expect(await broker.deliver({ kind: 'prompt', prompt })).toMatchObject({ status: 'failed' });

    const pageOnly = createChatTargetBroker();
    pageOnly.register(pageTarget, {});
    expect(await pageOnly.deliver({ kind: 'prompt', prompt })).toMatchObject({ status: 'unavailable' });
  });

  it('queues context for the visible busy target and drains it back to that same composer', async () => {
    const broker = createChatTargetBroker();
    const tab: AgentContextTabRef = {
      id: 'canvas:workspace-a',
      kind: 'canvas',
      title: 'Workspace A',
      workspaceId: 'workspace-a',
      dockWorkspaceId: 'workspace-a',
    };

    const unregisterBusyPage = broker.register(pageTarget, {});
    const receipt = await broker.deliver({ kind: 'tab', tab });

    expect(receipt).toEqual({ status: 'queued', target: pageTarget });

    const insertTab = vi.fn();
    const unregisterReadyPage = broker.register(pageTarget, { insertTab });
    expect(insertTab).toHaveBeenCalledOnce();
    expect(insertTab).toHaveBeenCalledWith(tab);

    unregisterReadyPage();
    unregisterBusyPage();
  });
});


describe('file reference delivery', () => {
  it('queues for the visible page composer and never inserts into hidden dock chat', async () => {
    const broker = createChatTargetBroker();
    const insertDockFile = vi.fn();
    const insertPageFile = vi.fn();
    broker.register(dockTarget, { insertFile: insertDockFile });
    broker.register(pageTarget, {});
    const filePath = '/outside workspace/资料.ts';
    expect(await broker.deliver({ kind: 'file', filePath })).toMatchObject({ status: 'queued', target: pageTarget });
    broker.register(pageTarget, { insertFile: insertPageFile });
    expect(insertPageFile).toHaveBeenCalledWith(filePath);
    expect(insertDockFile).not.toHaveBeenCalled();
  });
});


it('queues directory references for the intended page composer without converting them to files', async () => {
  const broker = createChatTargetBroker();
  broker.register(pageTarget, {});
  const insertFile = vi.fn();
  expect(await broker.deliver({ kind: 'file', filePath: '/root/source', isDirectory: true })).toMatchObject({ status: 'queued' });
  broker.register(pageTarget, { insertFile });
  expect(insertFile).toHaveBeenCalledWith('/root/source', true);
});
