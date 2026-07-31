/**
 * Orchestrates one externally-driven role segment: resolve the resumable CLI
 * session, render the context prompt, run the adapter, persist the new
 * session id. A run that fails while RESUMING retries once on a fresh
 * session (stale ids are the common cause); genuine failures rethrow so the
 * chat surfaces them as the segment's error.
 */

import type { AgentRoleDefinition, AgentRoleExternalDriver } from '../../../shared/agent-roles';
import type { CanvasAgentMessage, CanvasAgentToolCall } from '../types';
import type { ExternalStreamHandlers } from './tool-events';
import { resolveExternalCwd } from './cwd';
import { renderExternalSegmentPrompt } from './prompt';
import { runExternalSegment } from './runner';
import { clearExternalSessionId, getExternalSessionId, saveExternalSessionId } from './state-store';
import { requestAskModeApproval } from '../tool-policy';

const RESUME_FAILURE_RE = /session|conversation|resume/i;

export class ExternalRoleApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalRoleApprovalError';
  }
}

export async function runExternalRoleSegment(opts: ExternalStreamHandlers & {
  role: AgentRoleDefinition;
  external: AgentRoleExternalDriver;
  chatSessionId: string;
  /** Current workspace root, when the chat has one — the default work dir. */
  workspaceRootFolder?: string;
  history: CanvasAgentMessage[];
  currentAsk: string;
  handoffNames: string[];
  abortSignal: AbortSignal;
  executionMode?: 'auto' | 'ask';
  onApprovalRequest?: (request: {
    id: string;
    question: string;
    context?: string;
    defaultAnswer?: string;
    timeout: number;
  }) => Promise<string>;
}): Promise<{ text: string; toolCalls: CanvasAgentToolCall[] }> {
  const { role, external, chatSessionId } = opts;
  const approval = await requestAskModeApproval({
    name: `external_role_${external.family}`,
    operation: 'execute',
    input: {
      role: role.name,
      family: external.family,
      configuredCwd: external.cwd,
      currentAsk: opts.currentAsk,
    },
    context: {
      runContext: { executionMode: opts.executionMode ?? 'auto' },
      onClarificationRequest: opts.onApprovalRequest,
      abortSignal: opts.abortSignal,
      toolCallId: `external-role:${chatSessionId}:${role.id}`,
    },
  });
  if (!approval.approved) {
    throw new ExternalRoleApprovalError(
      approval.error ?? `External role ${role.name} was not approved and did not run.`,
    );
  }

  // Session continuity keys on the RESOLVED directory: @ the same role from
  // another workspace and it starts a fresh CLI session there.
  const cwd = await resolveExternalCwd({
    roleId: role.id,
    configuredCwd: external.cwd,
    workspaceRootFolder: opts.workspaceRootFolder,
  });
  const roleWithDriver = { id: role.id, external: { family: external.family, cwd } };
  const sessionId = await getExternalSessionId(chatSessionId, roleWithDriver);

  // Tool activity is mirrored into a persistable list as it streams, so a
  // reloaded session keeps the chips the live run showed.
  let toolCalls: CanvasAgentToolCall[] = [];
  let byId = new Map<string, CanvasAgentToolCall>();

  const runOnce = async (resumeId: string | undefined) => {
    toolCalls = [];
    byId = new Map();
    const prompt = renderExternalSegmentPrompt({
      role,
      cwd,
      history: opts.history,
      currentAsk: opts.currentAsk,
      handoffNames: opts.handoffNames,
      resumed: !!resumeId,
    });
    return runExternalSegment({
      family: external.family,
      cwd,
      prompt,
      sessionId: resumeId,
      abortSignal: opts.abortSignal,
      onText: opts.onText,
      onToolCall: (event) => {
        const tool: CanvasAgentToolCall = {
          id: toolCalls.length + 1,
          name: event.name,
          toolCallId: event.toolCallId,
          status: 'running',
          args: event.args,
        };
        toolCalls.push(tool);
        byId.set(event.toolCallId, tool);
        opts.onToolCall?.(event);
      },
      onToolResult: (event) => {
        const tool = event.toolCallId ? byId.get(event.toolCallId) : undefined;
        if (tool) {
          tool.status = event.status;
          tool.result = event.result;
          tool.error = event.error;
        }
        opts.onToolResult?.(event);
      },
    });
  };

  let result;
  try {
    result = await runOnce(sessionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!sessionId || opts.abortSignal.aborted || !RESUME_FAILURE_RE.test(message)) throw err;
    await clearExternalSessionId(chatSessionId, role.id);
    result = await runOnce(undefined);
  }

  if (result.sessionId) {
    await saveExternalSessionId(chatSessionId, roleWithDriver, result.sessionId);
  }
  return { text: result.text, toolCalls };
}
