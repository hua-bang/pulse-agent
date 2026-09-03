import { useCallback, type MutableRefObject } from 'react';
import type {
  CanvasNode,
  FileNodeData,
  FrameNodeData,
  GroupNodeData,
  ImageNodeData,
  MindmapNodeData,
  ShapeNodeData,
  TextNodeData,
} from '../../../types';
import {
  cloneMindmapTopic,
  createDefaultNode,
  createNodeData,
  genId,
} from '../../../utils/nodeFactory';
import { resizeGroupsToChildren } from '../../../utils/resizeGroupsToChildren';

export interface AddNodeOptions {
  fileName?: string;
  fileContent?: string;
  nodePatch?: Partial<CanvasNode>;
}

interface ContentCommandOptions {
  canvasId: string;
  nodesRef: MutableRefObject<CanvasNode[]>;
  applyNodes: (nodes: CanvasNode[], addToHistory?: boolean) => void;
}

const cloneNodeData = (
  source: CanvasNode,
  idMap?: ReadonlyMap<string, string>,
): CanvasNode['data'] => {
  if (source.type === 'frame') return { ...(source.data as FrameNodeData) };
  if (source.type === 'group') {
    const childIds = idMap
      ? ((source.data as GroupNodeData).childIds ?? [])
        .map(id => idMap.get(id))
        .filter((id): id is string => !!id)
      : [];
    return { ...(source.data as GroupNodeData), childIds };
  }
  if (source.type === 'text') return { ...(source.data as TextNodeData) };
  if (source.type === 'image') return { ...(source.data as ImageNodeData) };
  if (source.type === 'shape') return { ...(source.data as ShapeNodeData) };
  if (source.type === 'file') {
    return { ...(source.data as FileNodeData), filePath: '', saved: false, modified: false };
  }
  if (source.type === 'mindmap') {
    const data = source.data as MindmapNodeData;
    return { ...data, root: cloneMindmapTopic(data.root), rev: 0 } satisfies MindmapNodeData;
  }
  return createNodeData(source.type);
};

const materializeFileNode = async ({
  applyNodes,
  canvasId,
  content,
  fileName,
  nodeId,
  nodesRef,
  writeContent,
}: ContentCommandOptions & {
  content: string;
  fileName?: string;
  nodeId: string;
  writeContent: boolean;
}): Promise<void> => {
  const api = window.canvasWorkspace?.file;
  if (!api) return;
  const result = await api.createNote(canvasId, fileName);
  if (!result.ok || !result.filePath) return;
  if (writeContent) await api.write(result.filePath, content);
  const updated = nodesRef.current.map(node => node.id === nodeId
    ? {
        ...node,
        title: result.fileName?.replace(/\.md$/, '') || node.title,
        data: {
          ...node.data,
          filePath: result.filePath ?? '',
          content: writeContent ? content : (node.data as FileNodeData).content,
          saved: true,
          modified: false,
        },
      }
    : node);
  applyNodes(updated, false);
};

export const useCanvasContentCommands = (options: ContentCommandOptions) => {
  const { applyNodes, canvasId, nodesRef } = options;

  const addNode = useCallback((
    type: CanvasNode['type'],
    x: number,
    y: number,
    addOptions?: AddNodeOptions,
  ) => {
    const baseNode = createDefaultNode(type, x, y);
    const nodePatch = addOptions?.nodePatch ?? {};
    const node: CanvasNode = {
      ...baseNode,
      ...nodePatch,
      data: nodePatch.data ? { ...baseNode.data, ...nodePatch.data } : baseNode.data,
      updatedAt: Date.now(),
    };
    if (node.type === 'file') {
      void materializeFileNode({
        applyNodes,
        canvasId,
        nodesRef,
        nodeId: node.id,
        fileName: addOptions?.fileName,
        content: addOptions?.fileContent ?? '',
        writeContent: typeof addOptions?.fileContent === 'string',
      });
    }
    applyNodes([...nodesRef.current, node]);
    return node;
  }, [applyNodes, canvasId, nodesRef]);

  const duplicateNode = useCallback((id: string) => {
    const source = nodesRef.current.find(node => node.id === id);
    if (!source) return null;
    const duplicated: CanvasNode = {
      ...source,
      id: genId(),
      x: source.x + 24,
      y: source.y + 24,
      data: cloneNodeData(source),
      updatedAt: Date.now(),
    };
    if (duplicated.type === 'file') {
      void materializeFileNode({
        applyNodes,
        canvasId,
        nodesRef,
        nodeId: duplicated.id,
        fileName: duplicated.title,
        content: (source.data as FileNodeData).content,
        writeContent: true,
      });
    }
    applyNodes(resizeGroupsToChildren([...nodesRef.current, duplicated]));
    return duplicated;
  }, [applyNodes, canvasId, nodesRef]);

  const pasteNodes = useCallback((sources: CanvasNode[], offsetX = 24, offsetY = 24) => {
    if (sources.length === 0) return [];
    const idMap = new Map(sources.map(source => [source.id, genId()] as const));
    const now = Date.now();
    const pasted = sources.map((source): CanvasNode => ({
      ...source,
      id: idMap.get(source.id) ?? genId(),
      x: source.x + offsetX,
      y: source.y + offsetY,
      data: cloneNodeData(source, idMap),
      updatedAt: now,
    }));
    pasted.forEach((node, index) => {
      const source = sources[index];
      if (node.type !== 'file' || source?.type !== 'file') return;
      void materializeFileNode({
        applyNodes,
        canvasId,
        nodesRef,
        nodeId: node.id,
        fileName: node.title,
        content: (source.data as FileNodeData).content,
        writeContent: true,
      });
    });
    applyNodes(resizeGroupsToChildren([...nodesRef.current, ...pasted]));
    return pasted;
  }, [applyNodes, canvasId, nodesRef]);

  return { addNode, duplicateNode, pasteNodes };
};
