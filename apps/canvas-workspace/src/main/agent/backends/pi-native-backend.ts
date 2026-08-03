import { existsSync } from 'fs';
import { join } from 'path';

import type { CanvasAgentMessage, CanvasAgentToolCall } from '../types';
import { resolveExternalCwd } from '../external/cwd';
import { runPiSegment } from '../external/pi';
import {
  clearExternalSessionId,
  getExternalSessionId,
  saveExternalSessionId,
} from '../external/state-store';
import { requestAskModeApproval } from '../tool-policy';
import type { TurnBackend, TurnSegmentRequest, TurnSegmentResult } from './types';

/**
 * pi as the DEFAULT assistant (Phase 3 v1 of docs/09-agent-backend-boundary.md,
 * subprocess variant): the null-role segment runs on the local pi CLI instead
 * of the built-in engine, behind the `pi-native-chat` experimental flag. An
 * A/B measurement instrument, not a product mode.
 *
 * Reuses the proven external-segment primitives — cwd resolution, per-chat
 * session continuity, stale-resume retry, ask-mode approval — but renders a
 * NATIVE assistant prompt (no group-chat role protocol): pi IS the assistant
 * here, remembering its own session across turns, with a discussion window
 * sent regardless (overlap is cheaper than a gap, same rule as segment.ts).
 */

/** Sentinel "role" id for the session state store — not a real chat role. */
const PI_NATIVE_STATE_ID = '__pi_native_chat__';
const RESUME_FAILURE_RE = /session|conversation|resume/i;
const HISTORY_WINDOW = 12;
const MESSAGE_CHAR_CAP = 2000;

/**
 * Locate the shipped Pulse Canvas bridge extension (canvas tools over the
 * runtime-control server). Override with PULSE_CANVAS_PI_EXTENSION; dev runs
 * read it from the repo, packaged runs from extraResources. Missing file →
 * undefined, and the run proceeds bare (file/shell tools only).
 */
export function resolvePiExtensionPath(): string | undefined {
  const override = process.env.PULSE_CANVAS_PI_EXTENSION?.trim();
  if (override) return existsSync(override) ? override : undefined;
  const candidates: string[] = [];
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'pi-extension', 'pulse-canvas.ts'));
  }
  candidates.push(join(process.cwd(), 'resources', 'pi-extension', 'pulse-canvas.ts'));
  return candidates.find(candidate => existsSync(candidate));
}

export function renderPiNativePrompt(opts: {
  cwd: string;
  history: CanvasAgentMessage[];
  currentAsk: string;
  resumed: boolean;
}): string {
  const window = opts.history
    .filter(message => message.content.trim())
    .slice(-HISTORY_WINDOW)
    .map(message => `${message.role === 'user' ? '用户' : '助手'}: ${message.content.slice(0, MESSAGE_CHAR_CAP)}`);

  return [
    `你是 Pulse Canvas 工作区的 AI 助手,工作目录是 ${opts.cwd}(可以读写其中的文件、运行命令来完成请求)。`,
    '直接输出回复正文,以助手的身份与用户对话。',
    '',
    opts.resumed
      ? '## 近期对话(自动附带,可能与你会话里已知的内容有重叠)'
      : '## 近期对话',
    ...(window.length > 0 ? window : ['(这是本对话的第一条消息)']),
    '',
    '## 本轮请求',
    opts.currentAsk,
  ].join('\n');
}

export const piNativeTurnBackend: TurnBackend = {
  id: 'pi-native',
  capabilities: {
    // 'subset': the bridge extension exposes runtime-control canvas tools
    // (context read, node read/search, title/content update) — not the full
    // in-process registry. Workspace-scoped chats only; global/scheduled
    // scopes run bare (file/shell) because no workspace is bound.
    nativeCanvasTools: 'subset',
    clarifications: 'approval',
    historyFidelity: 'window',
    sessionResume: 'cli',
  },
  async runSegment(request: TurnSegmentRequest): Promise<TurnSegmentResult> {
    const approval = await requestAskModeApproval({
      name: 'pi_native_chat',
      operation: 'execute',
      input: { currentAsk: request.currentAsk },
      context: {
        runContext: { executionMode: request.executionMode },
        onClarificationRequest: request.onClarificationRequest,
        abortSignal: request.abortSignal,
        toolCallId: `pi-native:${request.chatSessionId}`,
      },
    });
    if (!approval.approved) {
      throw new Error(approval.error ?? 'pi-backed chat turn was not approved and did not run.');
    }

    const cwd = await resolveExternalCwd({
      roleId: PI_NATIVE_STATE_ID,
      workspaceRootFolder: request.workspaceRootFolder,
    });
    const stateRef = { id: PI_NATIVE_STATE_ID, external: { family: 'pi' as const, cwd } };
    const sessionId = await getExternalSessionId(request.chatSessionId, stateRef);

    // Tool activity mirrors into a persistable list as it streams, so a
    // reloaded session keeps the chips the live run showed.
    let toolCalls: CanvasAgentToolCall[] = [];
    let byId = new Map<string, CanvasAgentToolCall>();

    // Canvas bridge: attach the shipped pi extension + workspace binding for
    // workspace-scoped chats. Global/scheduled scopes have no workspace to
    // bind, so they run bare rather than shipping tools that can only error.
    const extensionPath = request.workspaceId ? resolvePiExtensionPath() : undefined;
    const bridgeEnv = request.workspaceId && extensionPath
      ? { PULSE_CANVAS_WORKSPACE_ID: request.workspaceId }
      : undefined;

    const runOnce = async (resumeId: string | undefined) => {
      toolCalls = [];
      byId = new Map();
      return runPiSegment({
        family: 'pi',
        cwd,
        prompt: renderPiNativePrompt({
          cwd,
          history: request.history,
          currentAsk: request.currentAsk,
          resumed: !!resumeId,
        }),
        sessionId: resumeId,
        extensionPaths: extensionPath ? [extensionPath] : undefined,
        env: bridgeEnv,
        abortSignal: request.abortSignal,
        onText: request.onText,
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
          request.onToolCall?.(event);
        },
        onToolResult: (event) => {
          const tool = event.toolCallId ? byId.get(event.toolCallId) : undefined;
          if (tool) {
            tool.status = event.status;
            tool.result = event.result;
            tool.error = event.error;
          }
          request.onToolResult?.(event);
        },
      });
    };

    let result;
    try {
      result = await runOnce(sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!sessionId || request.abortSignal.aborted || !RESUME_FAILURE_RE.test(message)) throw err;
      await clearExternalSessionId(request.chatSessionId, PI_NATIVE_STATE_ID);
      result = await runOnce(undefined);
    }

    if (result.sessionId) {
      await saveExternalSessionId(request.chatSessionId, stateRef, result.sessionId);
    }
    const message = { role: 'assistant' as const, content: result.text };
    request.recordResponseMessages([message]);
    return { resultText: result.text, toolCalls };
  },
};
