/**
 * Which node deletions need a confirmation, and what it should say.
 *
 * The default rule is "single deletes are instant, multi deletes confirm",
 * on the grounds that one node is one undo step away. Coding-agent nodes
 * break that assumption: unmounting one kills its PTY (`killSession` in
 * `useAgentNodeController`'s teardown), and one that belongs to an agent
 * team is deleted through the team API instead of the undo stack. Undo puts
 * the node back; it cannot put the session back. So an agent in the victim
 * set always confirms, even alone.
 *
 * Returns i18n keys rather than copy so the policy stays testable without a
 * translation table.
 */
import type { I18nKey } from '../../../../../../i18n';
import type { CanvasNode } from '../../../../../../types';

export interface NodeDeleteConfirmRequest {
  titleKey: I18nKey;
  descriptionKey: I18nKey;
  confirmKey: I18nKey;
  /** Interpolation values for the title (count, or the node's own label). */
  params?: Record<string, string>;
}

const isAgentNode = (node: CanvasNode): boolean => node.type === 'agent';

export function getNodeDeleteConfirm(
  victims: readonly CanvasNode[],
  /** Display label for the single-node case; the caller owns label rules. */
  labelOf: (node: CanvasNode) => string,
): NodeDeleteConfirmRequest | null {
  if (victims.length === 0) return null;
  const agents = victims.filter(isAgentNode);

  if (agents.length > 0) {
    // Alone, the agent IS the subject — name it, so the user can tell which
    // one they are about to end.
    if (victims.length === 1) {
      return {
        titleKey: 'canvas.deleteAgentNodeTitle',
        descriptionKey: 'canvas.deleteAgentNodeDescription',
        confirmKey: 'canvas.deleteAgentNodeConfirm',
        params: { title: labelOf(victims[0]) },
      };
    }
    // In a batch the count is what matters, but the agents are the part that
    // does not come back, so they get called out separately.
    return {
      titleKey: 'canvas.deleteNodesTitle',
      descriptionKey: 'canvas.deleteNodesWithAgentsDescription',
      confirmKey: 'canvas.deleteNodesConfirm',
      params: { count: String(victims.length), agentCount: String(agents.length) },
    };
  }

  // No agents: one keystroke can still wipe a whole marquee selection.
  if (victims.length > 1) {
    return {
      titleKey: 'canvas.deleteNodesTitle',
      descriptionKey: 'canvas.deleteNodesDescription',
      confirmKey: 'canvas.deleteNodesConfirm',
      params: { count: String(victims.length) },
    };
  }

  return null;
}
