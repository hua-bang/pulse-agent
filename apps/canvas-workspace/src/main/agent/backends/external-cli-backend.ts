import type { ModelMessage } from 'ai';

import { runExternalRoleSegment } from '../external/segment';
import type { AgentRuntime, TurnSegmentRequest, TurnSegmentResult } from './types';

/**
 * The external coding-agent CLI backend (Claude Code / Codex families).
 * The CLI owns its own session and tool loop; the reply is appended to the
 * shared model history by hand because an external CLI never calls the
 * engine's onResponse.
 */
export const externalCliTurnBackend: AgentRuntime = {
  id: 'external-cli',
  capabilities: {
    nativeCanvasTools: false,
    clarifications: 'approval',
    historyFidelity: 'window',
    sessionResume: 'cli',
    steering: 'none',
    compaction: 'cli',
  },
  async runSegment(request: TurnSegmentRequest): Promise<TurnSegmentResult> {
    const role = request.role;
    if (!role?.external) {
      throw new Error('externalCliTurnBackend requires a role with an external driver');
    }
    const external = await runExternalRoleSegment({
      role,
      external: role.external,
      chatSessionId: request.chatSessionId,
      workspaceRootFolder: request.workspaceRootFolder,
      history: request.history,
      currentAsk: request.currentAsk,
      handoffNames: request.handoffNames,
      abortSignal: request.abortSignal,
      executionMode: request.executionMode,
      onApprovalRequest: request.onClarificationRequest,
      onText: request.onText,
      onToolCall: request.onToolCall,
      onToolResult: request.onToolResult,
    });
    const message = { role: 'assistant', content: external.text } as ModelMessage;
    request.recordResponseMessages([message]);
    return { resultText: external.text, toolCalls: external.toolCalls };
  },
};
