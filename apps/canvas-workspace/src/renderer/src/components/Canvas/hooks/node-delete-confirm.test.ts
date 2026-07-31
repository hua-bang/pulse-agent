import { describe, expect, it } from 'vitest';
import { getNodeDeleteConfirm } from './node-delete-confirm';
import type { CanvasNode } from '../../../types';

const node = (id: string, type: CanvasNode['type']): CanvasNode => ({
  id,
  type,
  title: `${type} ${id}`,
  x: 0,
  y: 0,
  width: 200,
  height: 120,
  data: {},
} as CanvasNode);

const labelOf = (item: CanvasNode) => item.title ?? item.id;

describe('getNodeDeleteConfirm', () => {
  it('does not interrupt a single ordinary node delete', () => {
    // One node is one undo step away — asking every time would train people
    // to click through the dialog that matters.
    expect(getNodeDeleteConfirm([node('a', 'text')], labelOf)).toBeNull();
  });

  it('returns nothing for an empty victim set', () => {
    expect(getNodeDeleteConfirm([], labelOf)).toBeNull();
  });

  it('confirms a multi-node delete, since one keystroke can wipe a marquee', () => {
    const request = getNodeDeleteConfirm([node('a', 'text'), node('b', 'image')], labelOf);
    expect(request).toMatchObject({
      titleKey: 'canvas.deleteNodesTitle',
      descriptionKey: 'canvas.deleteNodesDescription',
      params: { count: '2' },
    });
  });

  it('confirms a LONE coding-agent delete, naming the agent', () => {
    // Deleting an agent node kills its PTY; undo restores the node, not the
    // session. That breaks the "single deletes are cheap" assumption.
    const request = getNodeDeleteConfirm([node('a', 'agent')], labelOf);
    expect(request).toMatchObject({
      titleKey: 'canvas.deleteAgentNodeTitle',
      descriptionKey: 'canvas.deleteAgentNodeDescription',
      confirmKey: 'canvas.deleteAgentNodeConfirm',
      params: { title: 'agent a' },
    });
  });

  it('calls out how many agents are in a mixed batch', () => {
    const request = getNodeDeleteConfirm(
      [node('a', 'text'), node('b', 'agent'), node('c', 'agent')],
      labelOf,
    );
    expect(request).toMatchObject({
      titleKey: 'canvas.deleteNodesTitle',
      descriptionKey: 'canvas.deleteNodesWithAgentsDescription',
      params: { count: '3', agentCount: '2' },
    });
  });

  it('treats a terminal node as ordinary — only agents get the extra prompt', () => {
    // Terminal nodes own a PTY too, but they are scratch shells the user
    // drove by hand; this change is scoped to coding agents.
    expect(getNodeDeleteConfirm([node('a', 'terminal')], labelOf)).toBeNull();
  });
});
