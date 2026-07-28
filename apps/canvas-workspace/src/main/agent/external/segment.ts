/**
 * Orchestrates one externally-driven role segment: resolve the resumable CLI
 * session, render the context prompt, run the adapter, persist the new
 * session id. A run that fails while RESUMING retries once on a fresh
 * session (stale ids are the common cause); genuine failures rethrow so the
 * chat surfaces them as the segment's error.
 */

import type { AgentRoleDefinition, AgentRoleExternalDriver } from '../../../shared/agent-roles';
import type { CanvasAgentMessage } from '../types';
import { renderExternalSegmentPrompt } from './prompt';
import { runExternalSegment } from './runner';
import { clearExternalSessionId, getExternalSessionId, saveExternalSessionId } from './state-store';

const RESUME_FAILURE_RE = /session|conversation|resume/i;

export async function runExternalRoleSegment(opts: {
  role: AgentRoleDefinition;
  external: AgentRoleExternalDriver;
  chatSessionId: string;
  history: CanvasAgentMessage[];
  currentAsk: string;
  handoffNames: string[];
  abortSignal: AbortSignal;
  onText: (delta: string) => void;
}): Promise<string> {
  const { role, external, chatSessionId } = opts;
  const roleWithDriver = { id: role.id, external };
  const sessionId = await getExternalSessionId(chatSessionId, roleWithDriver);

  const runOnce = async (resumeId: string | undefined) => {
    const prompt = renderExternalSegmentPrompt({
      role,
      cwd: external.cwd,
      history: opts.history,
      currentAsk: opts.currentAsk,
      handoffNames: opts.handoffNames,
      resumed: !!resumeId,
    });
    return runExternalSegment({
      family: external.family,
      cwd: external.cwd,
      prompt,
      sessionId: resumeId,
      abortSignal: opts.abortSignal,
      onText: opts.onText,
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
  return result.text;
}
