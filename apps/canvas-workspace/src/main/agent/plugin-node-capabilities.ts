import { getRegisteredNodeCapability } from '../../plugins/main/registry';
import type {
  PluginNodeCapabilityEntry,
  PluginNodePatch,
  PluginNodeWriteInput,
} from '../../plugins/types';
import type { CanvasNode as SharedCanvasNode } from '../../shared/canvas';

export type PluginCapabilityKind = 'read' | 'write' | 'action';

export interface CanvasNodeLike {
  id: string;
  type: string;
  title: string;
  data: Record<string, unknown>;
  updatedAt?: number;
}

export interface PluginNodeIdentity {
  pluginId: string;
  nodeType: string;
  payload: Record<string, unknown>;
}

export interface PluginNodeReadEnvelope {
  pluginId: string;
  nodeType: string;
  providerPluginId: string;
  capabilities: PluginCapabilityKind[];
  result: unknown;
  content: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getPluginNodeIdentity(node: CanvasNodeLike): PluginNodeIdentity | null {
  if (node.type !== 'plugin') return null;
  const pluginId = typeof node.data.pluginId === 'string' ? node.data.pluginId.trim() : '';
  const nodeType = typeof node.data.nodeType === 'string' ? node.data.nodeType.trim() : '';
  if (!pluginId || !nodeType) return null;

  return {
    pluginId,
    nodeType,
    payload: isRecord(node.data.payload) ? node.data.payload : {},
  };
}

export function getNodeCapabilityKinds(
  entry: PluginNodeCapabilityEntry | undefined,
): PluginCapabilityKind[] {
  if (!entry) return [];
  const kinds: PluginCapabilityKind[] = [];
  if (entry.capabilities.read) kinds.push('read');
  if (entry.capabilities.write) kinds.push('write');
  if (entry.capabilities.actions && Object.keys(entry.capabilities.actions).length > 0) {
    kinds.push('action');
  }
  return kinds;
}

export function getPluginNodeCapabilityKinds(node: CanvasNodeLike): PluginCapabilityKind[] {
  const identity = getPluginNodeIdentity(node);
  if (!identity) return [];
  const entry = getRegisteredNodeCapability(identity.nodeType);
  if (!entry || entry.pluginId !== identity.pluginId) return [];
  return getNodeCapabilityKinds(entry);
}

export function resolvePluginNodeCapability(
  node: CanvasNodeLike,
): { identity: PluginNodeIdentity; entry: PluginNodeCapabilityEntry } | null {
  const identity = getPluginNodeIdentity(node);
  if (!identity) return null;

  const entry = getRegisteredNodeCapability(identity.nodeType);
  if (!entry || entry.pluginId !== identity.pluginId) return null;
  return { identity, entry };
}

export function pluginReadResultToContent(result: unknown): string {
  if (typeof result === 'string') return result;
  if (isRecord(result) && typeof result.content === 'string') {
    return result.content;
  }
  return JSON.stringify(result, null, 2);
}

export function formatPluginNodeFallbackContent(node: CanvasNodeLike): string {
  const identity = getPluginNodeIdentity(node);
  if (!identity) {
    return '[plugin node is missing data.pluginId or data.nodeType]';
  }

  const payload = JSON.stringify(identity.payload, null, 2);
  return [
    `[plugin node: ${identity.pluginId}/${identity.nodeType}]`,
    'No registered read capability is available for this node type.',
    payload ? `Payload:\n${payload}` : 'Payload: {}',
  ].join('\n');
}

export async function readPluginNodeCapability(
  workspaceId: string,
  node: CanvasNodeLike,
): Promise<PluginNodeReadEnvelope | null> {
  const resolved = resolvePluginNodeCapability(node);
  if (!resolved || !resolved.entry.capabilities.read) return null;

  const result = await resolved.entry.capabilities.read({
    workspaceId,
    node: node as unknown as SharedCanvasNode,
  });

  return {
    pluginId: resolved.identity.pluginId,
    nodeType: resolved.identity.nodeType,
    providerPluginId: resolved.entry.pluginId,
    capabilities: getNodeCapabilityKinds(resolved.entry),
    result,
    content: pluginReadResultToContent(result),
  };
}

export function applyPluginNodePatch(
  node: CanvasNodeLike,
  patch: PluginNodePatch | undefined,
): boolean {
  if (!patch) return false;
  let changed = false;

  if (typeof patch.title === 'string' && patch.title !== node.title) {
    node.title = patch.title;
    changed = true;
  }

  if (isRecord(patch.data)) {
    node.data = {
      ...node.data,
      ...patch.data,
    };
    changed = true;
  }

  if (isRecord(patch.payload)) {
    const currentPayload = isRecord(node.data.payload) ? node.data.payload : {};
    node.data = {
      ...node.data,
      payload: {
        ...currentPayload,
        ...patch.payload,
      },
    };
    changed = true;
  }

  if (changed) node.updatedAt = Date.now();
  return changed;
}

export function patchFromWriteResult(
  result: unknown,
  fallbackInput?: PluginNodeWriteInput,
): PluginNodePatch | undefined {
  if (result === undefined || result === null) {
    return fallbackInput;
  }
  if (isRecord(result) && isRecord(result.patch)) {
    return result.patch as PluginNodePatch;
  }
  if (isRecord(result)) {
    return result as PluginNodePatch;
  }
  return undefined;
}

export function patchFromActionResult(result: unknown): PluginNodePatch | undefined {
  if (isRecord(result) && isRecord(result.patch)) {
    return result.patch as PluginNodePatch;
  }
  if (
    isRecord(result) &&
    (
      typeof result.title === 'string' ||
      isRecord(result.data) ||
      isRecord(result.payload)
    )
  ) {
    return result as PluginNodePatch;
  }
  return undefined;
}

export function actionPublicResult(result: unknown): unknown {
  if (isRecord(result) && 'result' in result) {
    return result.result;
  }
  return result;
}
