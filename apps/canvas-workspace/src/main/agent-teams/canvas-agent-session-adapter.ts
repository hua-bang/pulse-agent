import type {
  AgentSessionAdapter,
  AgentSessionRef,
  AgentStatus,
  CreateAgentSessionInput,
} from 'pulse-coder-agent-teams/runtime';
import {
  getCanvasAgentNode,
  interruptCanvasAgentNode,
  persistAgentNodeLaunchPrompt,
  sendOrQueueAgentInput,
} from './canvas-nodes';
import { CanvasAgentTeamStore } from './store';

export class CanvasAgentSessionAdapter implements AgentSessionAdapter {
  constructor(
    private readonly workspaceId: string,
    private readonly store: CanvasAgentTeamStore,
  ) {}

  async createSession(input: CreateAgentSessionInput): Promise<AgentSessionRef> {
    const metadata = await this.store.getTeamMetadata(input.teamId);
    const nodeId = metadata?.agentNodeIds[input.agentId];
    if (!nodeId) {
      throw new Error(`No canvas agent node mapped for agent ${input.agentId}`);
    }
    if (input.prompt) {
      await sendOrQueueAgentInput(this.workspaceId, nodeId, input.prompt);
    }
    return {
      sessionId: nodeId,
      provider: 'pulse-canvas-agent-node',
      displayName: input.name,
      metadata: {
        workspaceId: this.workspaceId,
        nodeId,
        role: input.role,
      },
    };
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    await sendOrQueueAgentInput(this.workspaceId, sessionId, input);
  }

  async persistLaunchPrompt(sessionId: string, prompt: string): Promise<void> {
    await persistAgentNodeLaunchPrompt(this.workspaceId, sessionId, prompt);
  }

  async interrupt(sessionId: string, mode: 'soft' | 'ctrl-c' | 'abort'): Promise<void> {
    await interruptCanvasAgentNode(this.workspaceId, sessionId, mode);
  }

  async getStatus(sessionId: string): Promise<AgentStatus> {
    const node = await getCanvasAgentNode(this.workspaceId, sessionId);
    if (!node) return 'stopped';
    if (node.status === 'running') return 'running';
    if (node.status === 'done') return 'done';
    if (node.status === 'error') return 'error';
    return 'idle';
  }
}
