import type { CanvasNode, MindmapNodeData, MindmapTopic } from '../types';
import { createDefaultNode, genTopicId } from './nodeFactory';
import {
  deleteTopic,
  findParent,
  findTopicPath,
  insertChild,
  type DropTarget,
} from './mindmapLayout';

export interface MergeMindmapTopicRequest {
  sourceNodeId: string;
  sourceTopicId: string;
  targetNodeId: string;
  target: DropTarget;
  createTopicId?: () => string;
}

export interface SplitMindmapTopicRequest {
  sourceNodeId: string;
  sourceTopicId: string;
  x: number;
  y: number;
  createNodeId?: () => string;
}

export interface MindmapTransferHandlers {
  onMergeMindmapTopic?: (request: MergeMindmapTopicRequest) => boolean;
  onSplitMindmapTopic?: (sourceNodeId: string, sourceTopicId: string, clientX: number, clientY: number) => boolean;
}

export interface MindmapTransferResult {
  nodes: CanvasNode[];
  insertedTopicId: string;
  removedNodeId?: string;
}

const asMindmapData = (node: CanvasNode): MindmapNodeData | null =>
  node.type === 'mindmap' ? node.data as MindmapNodeData : null;

export const getSelectionAfterMindmapMerge = (
  nodes: CanvasNode[],
  request: MergeMindmapTopicRequest,
): string[] | null => {
  const source = nodes.find((node) => node.id === request.sourceNodeId);
  const sourceData = source ? asMindmapData(source) : null;
  return sourceData?.root.id === request.sourceTopicId
    ? [request.targetNodeId]
    : null;
};

const cloneTopicWithIds = (
  topic: MindmapTopic,
  createTopicId: () => string,
): MindmapTopic => ({
  id: createTopicId(),
  text: topic.text,
  color: topic.color,
  collapsed: topic.collapsed,
  children: topic.children.map((child) => cloneTopicWithIds(child, createTopicId)),
});

const insertAtTarget = (
  root: MindmapTopic,
  child: MindmapTopic,
  target: DropTarget,
): MindmapTopic | null => {
  if (target.kind === 'child') {
    if (!findTopicPath(root, target.parentId)) return null;
    return insertChild(root, target.parentId, child);
  }

  const anchorParent = findParent(root, target.anchorId);
  if (!anchorParent) return null;
  const anchorIndex = anchorParent.children.findIndex(
    (candidate) => candidate.id === target.anchorId,
  );
  if (anchorIndex < 0) return null;
  const insertIndex = target.kind === 'before' ? anchorIndex : anchorIndex + 1;

  const walk = (topic: MindmapTopic): MindmapTopic => {
    if (topic.id === anchorParent.id) {
      const children = [...topic.children];
      children.splice(insertIndex, 0, child);
      return { ...topic, children, collapsed: false };
    }
    return { ...topic, children: topic.children.map(walk) };
  };
  return walk(root);
};

const withRoot = (
  node: CanvasNode,
  data: MindmapNodeData,
  root: MindmapTopic,
): CanvasNode => ({
  ...node,
  data: {
    ...data,
    root,
    rev: (data.rev ?? 0) + 1,
  },
  updatedAt: Date.now(),
});

export const mergeMindmapTopic = (
  nodes: CanvasNode[],
  request: MergeMindmapTopicRequest,
): MindmapTransferResult | null => {
  if (request.sourceNodeId === request.targetNodeId) return null;
  const sourceNode = nodes.find((node) => node.id === request.sourceNodeId);
  const targetNode = nodes.find((node) => node.id === request.targetNodeId);
  if (!sourceNode || !targetNode) return null;
  const sourceData = asMindmapData(sourceNode);
  const targetData = asMindmapData(targetNode);
  if (!sourceData || !targetData) return null;

  const sourcePath = findTopicPath(sourceData.root, request.sourceTopicId);
  if (!sourcePath) return null;
  const sourceTopic = sourcePath[sourcePath.length - 1];
  const insertedTopic = cloneTopicWithIds(
    sourceTopic,
    request.createTopicId ?? genTopicId,
  );
  const targetRoot = insertAtTarget(targetData.root, insertedTopic, request.target);
  if (!targetRoot) return null;

  const movingWholeMindmap = request.sourceTopicId === sourceData.root.id;
  let sourceRoot: MindmapTopic | null = null;
  if (!movingWholeMindmap) {
    const removed = deleteTopic(sourceData.root, request.sourceTopicId);
    if (!removed) return null;
    sourceRoot = removed.root;
  }

  const nextNodes: CanvasNode[] = [];
  for (const node of nodes) {
    if (node.id === request.sourceNodeId) {
      if (sourceRoot) nextNodes.push(withRoot(node, sourceData, sourceRoot));
      continue;
    }
    if (node.id === request.targetNodeId) {
      nextNodes.push(withRoot(node, targetData, targetRoot));
      continue;
    }
    nextNodes.push(node);
  }

  return {
    nodes: nextNodes,
    insertedTopicId: insertedTopic.id,
    removedNodeId: movingWholeMindmap ? sourceNode.id : undefined,
  };
};

export const splitMindmapTopic = (
  nodes: CanvasNode[],
  request: SplitMindmapTopicRequest,
): MindmapTransferResult | null => {
  const sourceNode = nodes.find((node) => node.id === request.sourceNodeId);
  if (!sourceNode) return null;
  const sourceData = asMindmapData(sourceNode);
  if (!sourceData || request.sourceTopicId === sourceData.root.id) return null;

  const sourcePath = findTopicPath(sourceData.root, request.sourceTopicId);
  const sourceTopic = sourcePath?.[sourcePath.length - 1];
  if (!sourceTopic) return null;
  const removed = deleteTopic(sourceData.root, request.sourceTopicId);
  if (!removed) return null;

  const detachedNode = createDefaultNode('mindmap', request.x, request.y);
  detachedNode.id = request.createNodeId?.() ?? detachedNode.id;
  detachedNode.title = sourceTopic.text || 'Mindmap';
  detachedNode.data = {
    root: sourceTopic,
    layout: sourceData.layout,
    rev: 0,
  } satisfies MindmapNodeData;

  return {
    nodes: [
      ...nodes.map((node) =>
        node.id === sourceNode.id
          ? withRoot(node, sourceData, removed.root)
          : node
      ),
      detachedNode,
    ],
    insertedTopicId: sourceTopic.id,
  };
};
