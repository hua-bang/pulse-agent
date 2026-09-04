import type { AgentContextCanvasRef, AgentContextDomSelectionRef, AgentContextNodeRef, AgentContextTagRef, CanvasNode } from '../../../../types';
import { readDomSelectionDataset } from './domMentionData';

/**
 * Collect structured, workspace-aware context refs from the inline mention
 * chips a user inserted into the composer. Used by the global Nodes/detail
 * assistant so cross-workspace `@`-mentions resolve precisely — node refs carry
 * their workspaceId, tags the workspaces they occur in, canvases their id.
 * (Moved out of ./mentions to keep it under the 500-line governance gate.)
 */
export function collectContextRefsFromEditable(editable: HTMLElement): {
  nodes: AgentContextNodeRef[];
  tags: AgentContextTagRef[];
  canvases: AgentContextCanvasRef[];
  domSelections: AgentContextDomSelectionRef[];
} {
  const nodes: AgentContextNodeRef[] = [];
  const tags: AgentContextTagRef[] = [];
  const canvases: AgentContextCanvasRef[] = [];
  const domSelections: AgentContextDomSelectionRef[] = [];
  const chips = editable.querySelectorAll<HTMLElement>('[data-mention-kind]');

  chips.forEach((chip) => {
    const kind = chip.dataset.mentionKind;
    const label = chip.querySelector('.chat-mention-chip-label')?.textContent ?? '';
    if (kind === 'node' && chip.dataset.nodeId) {
      nodes.push({
        id: chip.dataset.nodeId,
        title: label,
        type: (chip.dataset.nodeType ?? 'file') as CanvasNode['type'],
        workspaceId: chip.dataset.workspaceId || undefined,
      });
    } else if (kind === 'tag' && chip.dataset.tag) {
      const ids = chip.dataset.workspaceIds ? chip.dataset.workspaceIds.split(',').filter(Boolean) : [];
      tags.push({ name: chip.dataset.tag, workspaceIds: ids.length ? ids : undefined });
    } else if (kind === 'canvas' && chip.dataset.workspaceId) {
      canvases.push({ id: chip.dataset.workspaceId, name: label });
    } else if (kind === 'dom-selection') {
      const ref = readDomSelectionDataset(chip, label, domSelections.length);
      if (ref) domSelections.push(ref);
    }
  });

  return { nodes, tags, canvases, domSelections };
}
