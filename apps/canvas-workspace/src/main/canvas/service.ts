import { basename } from 'path';
import {
  STORE_DIR,
  getCanvasJsonPath,
  readCanvasFull,
  writeCanvasFull,
  type CanvasNode,
  type CanvasSaveData,
} from './storage';
import { broadcastCanvasUpdate } from './broadcast';

export { STORE_DIR };

export interface CanvasServiceOptions {
  root?: string;
}

export interface SaveCanvasOptions extends CanvasServiceOptions {
  /**
   * Allow writing an empty `nodes: []` over a populated canvas. Default false.
   */
  allowEmpty?: boolean;
}

export function canvasPath(workspaceId: string, root?: string): string {
  return getCanvasJsonPath(workspaceId, root);
}

export async function loadCanvas(
  workspaceId: string,
  options: CanvasServiceOptions = {},
): Promise<CanvasSaveData | null> {
  const { data } = await readCanvasFull(workspaceId, options.root);
  if (!data) return null;
  data.nodes = data.nodes ?? [];
  return data;
}

export async function saveCanvas(
  workspaceId: string,
  data: CanvasSaveData,
  options: SaveCanvasOptions = {},
): Promise<void> {
  data.savedAt = new Date().toISOString();

  if (!options.allowEmpty && Array.isArray(data.nodes) && data.nodes.length === 0) {
    const existing = await readCanvasFull(workspaceId, options.root).catch(() => {
      throw new Error(
        `[canvas-service] failed to read canvas.json while guarding empty write ` +
          `for workspace "${workspaceId}"`,
      );
    });
    const existingNodes = Array.isArray(existing.data?.nodes)
      ? existing.data.nodes
      : [];
    if (existingNodes.length > 0) {
      throw new Error(
        `[canvas-service] refusing to overwrite ${existingNodes.length} on-disk nodes ` +
          `with empty nodes for workspace "${workspaceId}". ` +
          `Pass { allowEmpty: true } to saveCanvas if this wipe is intentional.`,
      );
    }
  }

  await writeCanvasFull(workspaceId, data, options.root);
}

export interface AppendImageNodeInput extends CanvasServiceOptions {
  workspaceId: string;
  imagePath: string;
  title?: string;
}

export interface AppendCanvasNodeResult {
  nodeId: string;
  node: CanvasNode;
}

export async function appendImageNodeToCanvas(
  input: AppendImageNodeInput,
): Promise<AppendCanvasNodeResult> {
  const { workspaceId, imagePath } = input;
  if (!workspaceId || !imagePath) {
    throw new Error('workspaceId and imagePath are required');
  }

  const canvas = await loadCanvas(workspaceId, { root: input.root });
  if (!canvas) {
    throw new Error(`Canvas workspace "${workspaceId}" was not found`);
  }

  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
  const maxRight = nodes.reduce(
    (max, node) => Math.max(max, (node.x ?? 0) + (node.width ?? 0)),
    0,
  );
  const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const node: CanvasNode = {
    id: nodeId,
    type: 'image',
    title: input.title?.trim() || basename(imagePath),
    x: maxRight > 0 ? maxRight + 40 : 100,
    y: nodes[0]?.y ?? 100,
    width: 480,
    height: 360,
    data: { filePath: imagePath },
    updatedAt: Date.now(),
  };

  await saveCanvas(
    workspaceId,
    { ...canvas, nodes: [...nodes, node] },
    { root: input.root },
  );
  broadcastCanvasUpdate(workspaceId, [nodeId], 'create', 'canvas-agent');

  return { nodeId, node };
}
