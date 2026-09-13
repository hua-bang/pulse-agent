import { isReferenceableNodeType } from '../../utils/referenceNodes';
import type { NodeReferenceEntry } from './types';

export const REFERENCE_DRAG_TYPE = 'application/x-pulse-node-reference';

export const readReferenceDrag = (value: string): NodeReferenceEntry | null => {
  try {
    const entry = JSON.parse(value);
    if (entry?.kind !== 'node' || typeof entry.workspaceId !== 'string' || !entry.workspaceId
      || typeof entry.nodeId !== 'string' || !entry.nodeId) return null;
    return { kind: 'node', workspaceId: entry.workspaceId, nodeId: entry.nodeId,
      ...(isReferenceableNodeType(entry.typeSnapshot) ? { typeSnapshot: entry.typeSnapshot } : {}),
      ...(typeof entry.workspaceNameSnapshot === 'string' ? { workspaceNameSnapshot: entry.workspaceNameSnapshot } : {}),
      ...(typeof entry.titleSnapshot === 'string' ? { titleSnapshot: entry.titleSnapshot } : {}) };
  } catch { return null; }
};
