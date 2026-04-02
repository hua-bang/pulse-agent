/**
 * Converts canvas state (frame + contained agent nodes) into a RunTeamConfig.
 */
import type { CanvasNode, FrameNodeData, AgentNodeData, RunTeamConfig, TeamMemberConfig } from '../types';

/**
 * Check if a node's center is inside a frame.
 */
function isInsideFrame(node: CanvasNode, frame: CanvasNode): boolean {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return (
    cx >= frame.x &&
    cx <= frame.x + frame.width &&
    cy >= frame.y &&
    cy <= frame.y + frame.height
  );
}

/**
 * Find all agent nodes contained within a frame node.
 */
export function getAgentNodesInFrame(frameNode: CanvasNode, allNodes: CanvasNode[]): CanvasNode[] {
  return allNodes.filter(
    (n) => n.type === 'agent' && n.id !== frameNode.id && isInsideFrame(n, frameNode)
  );
}

/**
 * Convert a frame node + its contained agent nodes into a RunTeamConfig.
 * Returns null if the frame is not a team or has no agent members.
 */
export function canvasToTeamConfig(
  frameNode: CanvasNode,
  allNodes: CanvasNode[]
): RunTeamConfig | null {
  const frameData = frameNode.data as FrameNodeData;
  if (!frameData.isTeam) return null;

  const agentNodes = getAgentNodesInFrame(frameNode, allNodes);
  if (agentNodes.length === 0) return null;

  const members: TeamMemberConfig[] = agentNodes.map((n) => {
    const d = n.data as AgentNodeData;
    return {
      teammateId: d.teammateId || d.name || n.id,
      name: d.name || 'Unnamed Agent',
      role: d.role || '',
      runtime: d.runtime,
      isLead: d.isLead,
      model: d.model,
      spawnPrompt: d.spawnPrompt,
    };
  });

  // Ensure at least one lead
  const hasLead = members.some((m) => m.isLead);
  if (!hasLead && members.length > 0) {
    members[0].isLead = true;
  }

  return {
    teamId: frameData.teamId || `team-${frameNode.id}`,
    teamName: frameData.teamName || frameNode.title || 'Unnamed Team',
    goal: frameData.goal || '',
    members,
  };
}
