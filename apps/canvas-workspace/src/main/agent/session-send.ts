/**
 * Send follow-up input to a running agent node's PTY session.
 *
 * Used by both the in-process Canvas Agent tool (`canvas_send_to_agent`)
 * and the loopback runtime-control HTTP server, so external CLIs can
 * deliver input to agent nodes the same way the Canvas Agent does.
 *
 * The 120ms gap between body and CR is load-bearing for ratatui-style
 * TUI editors (Codex) that distinguish paste from keystroke by timing —
 * see the comment at the writeToSession call site for the full story.
 */

import { readCanvasFull } from '../canvas/storage';
import { hasSession, writeToSession } from '../terminal/pty-manager';

export interface SendInputToAgentNodeInput {
  workspaceId: string;
  nodeId: string;
  input: string;
}

export type SendInputToAgentNodeResult =
  | { ok: true; nodeId: string; bytesSent: number }
  | { ok: false; error: string; code: SendErrorCode };

export type SendErrorCode =
  | 'workspace_not_found'
  | 'node_not_found'
  | 'wrong_node_type'
  | 'not_running'
  | 'no_session'
  | 'write_failed';

const SUBMIT_DELAY_MS = 120;
const POST_SUBMIT_CONFIRM_MS = 350;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function sendInputToAgentNode(
  input: SendInputToAgentNodeInput,
): Promise<SendInputToAgentNodeResult> {
  const { workspaceId, nodeId } = input;
  const text = input.input ?? '';

  const { data: canvas } = await readCanvasFull(workspaceId);
  if (!canvas) {
    return { ok: false, error: `workspace not found: ${workspaceId}`, code: 'workspace_not_found' };
  }

  const nodes = canvas.nodes ?? [];
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) {
    return { ok: false, error: `node not found: ${nodeId}`, code: 'node_not_found' };
  }
  if (node.type !== 'agent') {
    return {
      ok: false,
      error: `node "${nodeId}" is type "${node.type}", not "agent"`,
      code: 'wrong_node_type',
    };
  }

  const status = (node.data?.status as string | undefined) ?? 'idle';
  if (status !== 'running') {
    return {
      ok: false,
      error: `agent node "${node.title ?? nodeId}" is not running (status="${status}")`,
      code: 'not_running',
    };
  }

  const sessionId = (node.data?.sessionId as string | undefined) ?? '';
  if (!sessionId || !hasSession(sessionId)) {
    return {
      ok: false,
      error: `agent node "${node.title ?? nodeId}" has no active PTY session`,
      code: 'no_session',
    };
  }

  // Strip any trailing CR/LF the caller might have included so we
  // control the submit signal ourselves.
  const body = text.replace(/[\r\n]+$/, '');

  // Write body and Enter as TWO separate writes with a small gap.
  //
  // Some TUI agents (Codex) distinguish "paste" from "keystroke" by
  // timing: if the text body and the \r arrive in the same read, the \r
  // gets absorbed into the editor buffer as a literal newline and the
  // prompt is never submitted. Writing the body, yielding for ~120ms,
  // then writing \r as a second call makes the Enter arrive as an
  // independent keystroke. Claude Code is happy either way.
  if (body) {
    if (!writeToSession(sessionId, body)) {
      return {
        ok: false,
        error: `failed to write to PTY session ${sessionId} (session disappeared)`,
        code: 'write_failed',
      };
    }
    await wait(SUBMIT_DELAY_MS);
  }
  if (!writeToSession(sessionId, '\r')) {
    return {
      ok: false,
      error: `failed to write Enter to PTY session ${sessionId} (session disappeared)`,
      code: 'write_failed',
    };
  }
  await wait(POST_SUBMIT_CONFIRM_MS);
  if (!hasSession(sessionId)) {
    return {
      ok: false,
      error: `failed to confirm delivery to PTY session ${sessionId} (session disappeared after submit)`,
      code: 'write_failed',
    };
  }

  return { ok: true, nodeId, bytesSent: body.length + 1 };
}
