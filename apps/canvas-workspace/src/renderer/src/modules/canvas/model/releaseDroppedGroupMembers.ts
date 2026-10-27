import type { CanvasNode, GroupNodeData } from '../../../types';
import { collectContainerDescendants, isInsideContainer } from '../../../utils/frameHierarchy';

/**
 * A group member that is dropped into a frame outside its group leaves the
 * group. Without this, the group grows to follow the member, swallows the
 * frame, and the member never joins the frame.
 *
 * `before` is the node list before the move. A group that moved too keeps
 * its members, and a frame that was already inside the group does not
 * release them.
 */
export const releaseDroppedGroupMembers = (
  before: CanvasNode[],
  after: CanvasNode[],
  movedIds: ReadonlySet<string>,
): CanvasNode[] => {
  const frames = after.filter((node) => node.type === 'frame' && !movedIds.has(node.id));
  if (frames.length === 0) return after;

  const afterById = new Map(after.map((node) => [node.id, node] as const));
  const removals = new Map<string, Set<string>>();

  for (const group of before) {
    if (group.type !== 'group' || movedIds.has(group.id)) continue;
    const childIds = (group.data as GroupNodeData).childIds;
    if (!Array.isArray(childIds)) continue;
    const moved = childIds.filter((id) => movedIds.has(id));
    if (moved.length === 0) continue;

    const ownFrames = new Set(collectContainerDescendants(group.id, before).map((node) => node.id));
    for (const id of moved) {
      const member = afterById.get(id);
      if (!member) continue;
      const target = frames.find((frame) => (
        frame.id !== id && !ownFrames.has(frame.id) && isInsideContainer(member, frame)
      ));
      if (!target) continue;
      const set = removals.get(group.id) ?? new Set<string>();
      set.add(id);
      removals.set(group.id, set);
    }
  }

  if (removals.size === 0) return after;
  const now = Date.now();
  return after.map((node) => {
    const removed = removals.get(node.id);
    if (!removed) return node;
    const data = node.data as GroupNodeData;
    const childIds = (data.childIds ?? []).filter((id) => !removed.has(id));
    return { ...node, data: { ...data, childIds }, updatedAt: now };
  });
};
