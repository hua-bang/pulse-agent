import type { Engine } from 'pulse-coder-engine';
import type { MCPAppsManager } from 'pulse-coder-engine/built-in';
import { randomUUID } from 'crypto';
import type { AgentChatMcpApp } from '../../shared/agent-chat';

export function resolveMcpApp(
  manager: MCPAppsManager | undefined,
  registeredToolName: string,
  toolCallId?: string,
): AgentChatMcpApp | undefined {
  const app = manager?.getToolApp(registeredToolName);
  const result = toolCallId ? manager?.getToolResult(toolCallId) : undefined;
  return app ? {
    serverName: app.serverName,
    toolName: app.toolName,
    resourceUri: app.resourceUri,
    ...(result !== undefined ? { result } : {}),
  } : undefined;
}

export async function executeMcpAppTool(
  engine: Engine,
  registeredToolName: string,
  args: unknown,
  abortSignal: AbortSignal,
): Promise<{ result: unknown; toolCallId: string }> {
  const toolCallId = `mcp-app:${randomUUID()}`;
  const session = await engine.createToolSession(
    { messages: [] },
    { runContext: { executionMode: 'auto', caller: 'mcp-app' } },
  );
  try {
    const result = await session.executeRegisteredTool(registeredToolName, args, {
      toolCallId,
      abortSignal,
    });
    return { result, toolCallId };
  } finally {
    await session.dispose();
  }
}
