/**
 * Hook that listens to agent-team events and syncs canvas node state.
 * Updates agent node status, frame team status, etc. based on IPC events.
 */
import { useEffect } from 'react';
import type { CanvasNode, AgentNodeData, FrameNodeData } from '../types';

interface TeamEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export function useTeamEvents(
  nodes: CanvasNode[],
  updateNode: (id: string, patch: Partial<CanvasNode>) => void
): void {
  useEffect(() => {
    const api = window.canvasWorkspace?.agentTeam;
    if (!api) return;

    const unsub = api.onEvent((raw: unknown) => {
      const event = raw as TeamEvent;
      if (!event?.type) return;

      switch (event.type) {
        case 'agent:spawned': {
          const { teammateId, status, sessionId } = event.data as {
            teammateId: string;
            status: string;
            sessionId?: string;
          };
          const agentNode = findAgentNode(nodes, teammateId);
          if (agentNode) {
            const d = agentNode.data as AgentNodeData;
            updateNode(agentNode.id, {
              data: { ...d, status: status || 'running', sessionId },
            });
          }
          break;
        }

        case 'agent:exited': {
          const { teammateId, status } = event.data as {
            teammateId: string;
            status: string;
          };
          const agentNode = findAgentNode(nodes, teammateId);
          if (agentNode) {
            const d = agentNode.data as AgentNodeData;
            updateNode(agentNode.id, {
              data: { ...d, status: status || 'completed' },
            });
          }

          // Check if all agents in a team are done → update frame status
          checkTeamCompletion(nodes, updateNode);
          break;
        }

        case 'agent:stopped': {
          const { teammateId } = event.data as { teammateId: string };
          const agentNode = findAgentNode(nodes, teammateId);
          if (agentNode) {
            const d = agentNode.data as AgentNodeData;
            updateNode(agentNode.id, {
              data: { ...d, status: 'stopped' },
            });
          }
          break;
        }

        case 'team:started': {
          const { teamId } = event.data as { teamId: string };
          const frameNode = findTeamFrame(nodes, teamId);
          if (frameNode) {
            const d = frameNode.data as FrameNodeData;
            updateNode(frameNode.id, {
              data: { ...d, teamStatus: 'running' },
            });
          }
          break;
        }

        case 'team:stopped': {
          const { teamId } = event.data as { teamId: string };
          const frameNode = findTeamFrame(nodes, teamId);
          if (frameNode) {
            const d = frameNode.data as FrameNodeData;
            updateNode(frameNode.id, {
              data: { ...d, teamStatus: 'idle' },
            });
          }
          break;
        }
      }
    });

    return unsub;
  }, [nodes, updateNode]);
}

function findAgentNode(nodes: CanvasNode[], teammateId: string): CanvasNode | undefined {
  return nodes.find((n) => {
    if (n.type !== 'agent') return false;
    const d = n.data as AgentNodeData;
    return d.teammateId === teammateId || d.name === teammateId;
  });
}

function findTeamFrame(nodes: CanvasNode[], teamId: string): CanvasNode | undefined {
  return nodes.find((n) => {
    if (n.type !== 'frame') return false;
    const d = n.data as FrameNodeData;
    return d.isTeam && d.teamId === teamId;
  });
}

/**
 * Check if all agents inside team frames are done, and update frame status.
 */
function checkTeamCompletion(
  nodes: CanvasNode[],
  updateNode: (id: string, patch: Partial<CanvasNode>) => void
): void {
  const teamFrames = nodes.filter(
    (n) => n.type === 'frame' && (n.data as FrameNodeData).isTeam && (n.data as FrameNodeData).teamStatus === 'running'
  );

  for (const frame of teamFrames) {
    const agentsInFrame = nodes.filter((n) => {
      if (n.type !== 'agent') return false;
      const cx = n.x + n.width / 2;
      const cy = n.y + n.height / 2;
      return cx >= frame.x && cx <= frame.x + frame.width && cy >= frame.y && cy <= frame.y + frame.height;
    });

    if (agentsInFrame.length === 0) continue;

    const allDone = agentsInFrame.every((n) => {
      const status = (n.data as AgentNodeData).status;
      return status === 'completed' || status === 'failed' || status === 'stopped';
    });

    if (allDone) {
      const anyFailed = agentsInFrame.some((n) => (n.data as AgentNodeData).status === 'failed');
      const d = frame.data as FrameNodeData;
      updateNode(frame.id, {
        data: { ...d, teamStatus: anyFailed ? 'failed' : 'completed' },
      });
    }
  }
}
