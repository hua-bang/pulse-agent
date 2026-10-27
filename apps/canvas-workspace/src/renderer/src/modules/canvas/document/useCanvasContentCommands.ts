import { useCallback, type MutableRefObject } from 'react';
import type { CanvasNode, FileNodeData } from '../../../types';
import { createDefaultNode, genId } from '../../../utils/nodeFactory';
import { pasteOffset } from '../model/pasteOffset';
import { withContainerDescendants } from '../../../utils/frameHierarchy';
import { cloneNodeData } from './cloneNodeData';
import { resizeGroupsToChildren } from '../model/resizeGroupsToChildren';

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
        // Only a requested name becomes the title. The generated fallback
        // (`note-<timestamp>`) is a storage detail, so keep "Untitled".
        title: fileName ? result.fileName?.replace(/\.md$/, '') || node.title : node.title,
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
    void window.canvasWorkspace?.telemetry?.track('node_created', { type: node.type });
    return node;
  }, [applyNodes, canvasId, nodesRef]);

  const pasteNodes = useCallback((sources: CanvasNode[]) => {
    if (sources.length === 0) return [];
    const { x: offsetX, y: offsetY } = pasteOffset(sources, nodesRef.current);
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

  // One history entry for the whole selection, so a single undo removes
  // every copy.
  const duplicateNodes = useCallback((ids: readonly string[]) => {
    const idSet = new Set(ids);
    const selected = nodesRef.current.filter(node => idSet.has(node.id));
    return pasteNodes(withContainerDescendants(selected, nodesRef.current));
  }, [nodesRef, pasteNodes]);

  return { addNode, duplicateNodes, pasteNodes };
};
