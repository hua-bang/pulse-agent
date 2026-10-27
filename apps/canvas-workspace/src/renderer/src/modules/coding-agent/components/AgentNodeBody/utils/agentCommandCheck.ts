import { getAgentCommand } from '../../../../../config/agentRegistry';

/**
 * The first CLI this agent needs that is not on PATH, or null when all are
 * there or the check is not available. A canvas workspace also needs
 * `pulse-canvas`, which the agent uses to reach the canvas.
 */
export const findMissingAgentCommand = async (
  agentType: string,
  workspaceId: string | undefined,
): Promise<string | null> => {
  const command = getAgentCommand(agentType);
  if (!command) return null;
  const api = window.canvasWorkspace?.pty;
  if (!api?.checkCommand) return null;
  const commands = workspaceId && command !== 'pulse-canvas' ? [command, 'pulse-canvas'] : [command];
  for (const requiredCommand of commands) {
    const result = await api.checkCommand(requiredCommand);
    if (!(result.ok && result.available)) return requiredCommand;
  }
  return null;
};
