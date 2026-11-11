import { useCallback, type MutableRefObject } from 'react';
import type { CanvasEdge, CanvasNode, FileNodeData } from '../../../types';
import { genEdgeId } from '../../../../../shared/canvas-node-defaults';
import { createDefaultNode, genId } from '../../../utils/nodeFactory';
import { offsetToCentre, pasteOffset } from '../model/pasteOffset';
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

interface PasteCommandOptions extends ContentCommandOptions {
  edgesRef: MutableRefObject<CanvasEdge[]>;
  applyState: (state: { nodes: CanvasNode[]; edges: CanvasEdge[] }) => void;
}

export interface PasteNodesOptions {
  /** Edges copied with the nodes. See `edgesAmong`. */
  edges?: readonly CanvasEdge[];
  /** Canvas point that the centre of the pasted selection lands on. */
  at?: { x: number; y: number };
}

/**
 * The edges that belong to a copied selection: at least one end is a copied
 * node, and no end is a node outside the selection.
 */
export const edgesAmong = (
  edges: readonly CanvasEdge[],
  nodes: readonly CanvasNode[],
): CanvasEdge[] => {
  const ids = new Set(nodes.map(node => node.id));
  const inside = (end: CanvasEdge['source']) => end.kind !== 'node' || ids.has(end.nodeId);
  return edges.filter(edge => (
    (edge.source.kind === 'node' || edge.target.kind === 'node')
    && inside(edge.source)
    && inside(edge.target)
  ));
};

const cloneEdge = (
  edge: CanvasEdge,
  idMap: ReadonlyMap<string, string>,
  offset: { x: number; y: number },
  now: number,
): CanvasEdge => {
  const end = (value: CanvasEdge['source']): CanvasEdge['source'] => (
    value.kind === 'node'
      ? { ...value, nodeId: idMap.get(value.nodeId) ?? value.nodeId }
      : { ...value, x: value.x + offset.x, y: value.y + offset.y }
  );
  return { ...edge, id: genEdgeId(), source: end(edge.source), target: end(edge.target), updatedAt: now };
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

export const useCanvasContentCommands = (options: PasteCommandOptions) => {
  const { applyNodes, applyState, canvasId, edgesRef, nodesRef } = options;

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

  const pasteNodes = useCallback((sources: CanvasNode[], pasteOptions?: PasteNodesOptions) => {
    if (sources.length === 0) return [];
    const offset = pasteOptions?.at
      ? offsetToCentre(sources, pasteOptions.at)
      : pasteOffset(sources, nodesRef.current);
    const { x: offsetX, y: offsetY } = offset;
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
    const nodes = resizeGroupsToChildren([...nodesRef.current, ...pasted]);
    const edges = edgesAmong(pasteOptions?.edges ?? [], sources)
      .map(edge => cloneEdge(edge, idMap, offset, now));
    // Nodes and their edges are one history entry.
    if (edges.length > 0) applyState({ nodes, edges: [...edgesRef.current, ...edges] });
    else applyNodes(nodes);
    return pasted;
  }, [applyNodes, applyState, canvasId, edgesRef, nodesRef]);

  // One history entry for the whole selection, so a single undo removes
  // every copy.
  const duplicateNodes = useCallback((ids: readonly string[]) => {
    const idSet = new Set(ids);
    const selected = nodesRef.current.filter(node => idSet.has(node.id));
    return pasteNodes(
      withContainerDescendants(selected, nodesRef.current),
      { edges: edgesRef.current },
    );
  }, [edgesRef, nodesRef, pasteNodes]);

  return { addNode, duplicateNodes, pasteNodes };
};
