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

  it('leaves Graph and Canvas on workspace-scoped chat', () => {
    const selectedNode = { workspaceId: 'workspace-a', nodeId: 'node-3' };

    expect(resolveKnowledgeChatRouteContext({
      activeView: 'graph',
      selectedNode,
      detailNode: null,
    })).toEqual({ active: false, selectedNode: null });
    expect(resolveKnowledgeChatRouteContext({
      activeView: 'canvas',
      selectedNode,
      detailNode: null,
    })).toEqual({ active: false, selectedNode: null });
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
