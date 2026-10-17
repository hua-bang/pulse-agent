import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeChatContext,
  resolveKnowledgeChatRouteContext,
} from '../knowledgeChatContext';

describe('resolveKnowledgeChatRouteContext', () => {
  it('uses global knowledge chat on the Nodes list without selecting context automatically', () => {
    expect(resolveKnowledgeChatRouteContext({
      activeView: 'nodes',
      selectedNode: null,
      detailNode: null,
    })).toEqual({
      active: true,
      knowledgeMode: true,
      selectedNode: null,
    });
  });

  it('keeps the same node context when a drawer opens as a full detail page', () => {
    const selectedNode = { workspaceId: 'workspace-b', nodeId: 'node-7' };
    const drawer = resolveKnowledgeChatRouteContext({
      activeView: 'nodes',
      selectedNode,
      detailNode: null,
    });
    const fullPage = resolveKnowledgeChatRouteContext({
      activeView: 'node-detail',
      selectedNode: null,
      detailNode: selectedNode,
    });

    expect(fullPage).toEqual(drawer);
  });

  it('keeps an explicitly invoked list context on the Nodes route', () => {
    const explicitContext = {
      nodes: [{ id: 'node-2', title: 'Gemini', type: 'iframe' as const, workspaceId: 'workspace-b' }],
      composerRequest: { id: 'request-1', text: 'Explain this node.' },
    };

    expect(resolveKnowledgeChatRouteContext({
      activeView: 'nodes',
      selectedNode: null,
      detailNode: null,
      explicitContext,
    })).toEqual({
      active: true,
      knowledgeMode: true,
      selectedNode: null,
      explicitContext,
    });
  });

  it('uses knowledge chat on Graph without adding the selected node', () => {
    expect(resolveKnowledgeChatRouteContext({
      activeView: 'graph',
      selectedNode: { workspaceId: 'workspace-a', nodeId: 'node-3' },
      detailNode: null,
    })).toEqual({ active: true, knowledgeMode: true, selectedNode: null });
  });

  it('leaves Canvas on workspace-scoped chat', () => {
    const selectedNode = { workspaceId: 'workspace-a', nodeId: 'node-3' };

    expect(resolveKnowledgeChatRouteContext({
      activeView: 'canvas',
      selectedNode,
      detailNode: null,
    })).toEqual({ active: false, knowledgeMode: false, selectedNode: null });
  });

  it('opens the plain global chat on other launcher routes', () => {
    for (const activeView of ['plugins', 'scheduled', 'mcp-app']) {
      expect(resolveKnowledgeChatRouteContext({
        activeView,
        selectedNode: { workspaceId: 'workspace-a', nodeId: 'node-3' },
        detailNode: null,
      })).toEqual({ active: true, knowledgeMode: false, selectedNode: null });
    }
  });

  it('follows the library the Skills page shows', () => {
    const base = { activeView: 'skills', selectedNode: null, detailNode: null };
    expect(resolveKnowledgeChatRouteContext(base).active).toBe(false);
    expect(resolveKnowledgeChatRouteContext({ ...base, skillsLibraryGlobal: true }))
      .toEqual({ active: true, knowledgeMode: false, selectedNode: null });
  });

  it('carries the task asked about on the Scheduled list only', () => {
    const scheduledTasks = [{ id: 'daily-brief', title: 'Daily brief' }];
    const onList = resolveKnowledgeChatRouteContext({
      activeView: 'scheduled', selectedNode: null, detailNode: null, scheduledTasks,
    });
    expect(onList).toEqual({ active: true, knowledgeMode: false, selectedNode: null, scheduledTasks });
    // The same array reaches the chat, so its request context stays stable.
    expect(onList.scheduledTasks).toBe(scheduledTasks);
    expect(resolveKnowledgeChatRouteContext({
      activeView: 'plugins', selectedNode: null, detailNode: null, scheduledTasks,
    }).scheduledTasks).toBeUndefined();
  });

  it('leaves full-page chat, home and settings without a dock chat', () => {
    for (const activeView of ['chat', 'scheduled-task', 'home', 'settings']) {
      expect(resolveKnowledgeChatRouteContext({
        activeView,
        selectedNode: null,
        detailNode: null,
      }).active).toBe(false);
    }
  });
});

describe('buildKnowledgeChatContext', () => {
  it('builds cross-workspace mention candidates and the selected node context', () => {
    const nodes = [
      {
        workspaceId: 'workspace-a',
        workspaceName: 'Canvas A',
        id: 'node-1',
        type: 'text',
        displayTitle: 'Search needs explicit intent',
        tags: ['tag-product'],
        hasData: true,
        linkCount: 0,
      },
      {
        workspaceId: 'workspace-b',
        workspaceName: 'Canvas B',
        id: 'node-2',
        type: 'iframe',
        title: 'Gemini',
        tags: ['tag-product'],
        hasData: true,
        linkCount: 0,
      },
    ];

    expect(buildKnowledgeChatContext(
      nodes,
      [{ id: 'tag-product', name: 'Product' }],
      { workspaceId: 'workspace-b', nodeId: 'node-2' },
    )).toEqual({
      knowledgeNodes: [
        {
          id: 'node-1',
          title: 'Search needs explicit intent',
          type: 'text',
          workspaceId: 'workspace-a',
        },
        {
          id: 'node-2',
          title: 'Gemini',
          type: 'iframe',
          workspaceId: 'workspace-b',
        },
      ],
      knowledgeTags: [
        {
          id: 'tag-product',
          name: 'Product',
          workspaceIds: ['workspace-a', 'workspace-b'],
        },
      ],
      contextNodes: [
        {
          id: 'node-2',
          title: 'Gemini',
          type: 'iframe',
          workspaceId: 'workspace-b',
        },
      ],
    });
  });
});
