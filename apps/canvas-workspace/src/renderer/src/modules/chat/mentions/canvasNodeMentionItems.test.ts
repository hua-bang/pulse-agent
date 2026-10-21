import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadCanvasNodeMentionItems,
  resetCanvasNodeMentionItemsForTests,
} from './canvasNodeMentionItems';

const workspaces = [
  { id: 'ws-current', name: 'Current' },
  { id: 'ws-harness', name: 'Harness' },
  { id: 'ws-broken', name: 'Broken' },
];

const stubWorkspaceNodes = () => {
  const list = vi.fn(async (workspaceId: string) => {
    if (workspaceId === 'ws-broken') throw new Error('unreadable');
    return {
      ok: true,
      nodes: [
        { id: 'text-1', type: 'text', title: 'Text', displayTitle: 'Harness notes', tags: [] },
        { id: 'mind-1', type: 'mindmap', title: '', displayTitle: '', tags: [] },
        { id: 'agent-1', type: 'agent', title: 'Harness agent', tags: [] },
      ],
    };
  });
  vi.stubGlobal('window', { canvasWorkspace: { workspaceNodes: { list } } });
  return list;
};

afterEach(() => {
  resetCanvasNodeMentionItemsForTests();
  vi.unstubAllGlobals();
});

describe('canvas node mention items', () => {
  it('offers knowledge nodes of the other canvases with their canvas name', async () => {
    const list = stubWorkspaceNodes();

    await expect(loadCanvasNodeMentionItems(workspaces, 'ws-current')).resolves.toEqual([
      {
        type: 'node',
        nodeId: 'text-1',
        label: 'Harness notes',
        nodeType: 'text',
        workspaceId: 'ws-harness',
        description: 'Harness',
      },
      {
        type: 'node',
        nodeId: 'mind-1',
        label: 'mind-1',
        nodeType: 'mindmap',
        workspaceId: 'ws-harness',
        description: 'Harness',
      },
    ]);
    expect(list).not.toHaveBeenCalledWith('ws-current');
  });

  it('reuses the cached read while the canvas set is unchanged', async () => {
    const list = stubWorkspaceNodes();

    await loadCanvasNodeMentionItems(workspaces, 'ws-current');
    await loadCanvasNodeMentionItems(workspaces, 'ws-current');
    expect(list).toHaveBeenCalledTimes(2);

    await loadCanvasNodeMentionItems(workspaces, 'ws-harness');
    expect(list).toHaveBeenCalledWith('ws-current');
  });

  it('skips the read when no other canvas exists', async () => {
    const list = stubWorkspaceNodes();

    await expect(loadCanvasNodeMentionItems([workspaces[0]], 'ws-current')).resolves.toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
});
