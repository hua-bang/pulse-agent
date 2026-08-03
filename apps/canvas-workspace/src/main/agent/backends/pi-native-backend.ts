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
import { preparePiModelBridge } from './pi-model-bridge';
import { preparePiToolBridge } from './pi-tool-bridge';
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
    // The manifest and execution bridge are both derived from this scope's
    // initialized Engine, so pi sees the same registered tools and hooks as
    // the native backend. Built-in pi tools stay disabled to prevent bypass.
    nativeCanvasTools: 'full',
    clarifications: 'approval',
    historyFidelity: 'window',
    sessionResume: 'cli',
  },
  async runSegment(request: TurnSegmentRequest): Promise<TurnSegmentResult> {
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

    // Full tool bridge: the extension registers a manifest generated from
    // this scope's actual Engine tool table. Execution returns to the same
    // Tool objects through the Engine tool session, preserving validation,
    // workspace closures, Ask-mode policy, offload, and plugin hooks.
    const extensionPath = resolvePiExtensionPath();
    if (!extensionPath) {
      throw new Error('Pulse Canvas pi tool extension was not found; refusing to run with a partial tool set.');
    }
    // Model parity: mirror the canvas model config into a pi custom provider
    // so both backends call the SAME upstream (incl. third-party compatible
    // APIs). Absent a usable key, fall back to the user's own pi config.
    const modelBridge = await preparePiModelBridge(
      request.configuredModel ?? request.modelConfig.model,
    );
    // Create the ephemeral tool bridge only after persistent model setup has
    // succeeded, so a config error cannot leak an active bridge or manifest.
    const toolBridge = await preparePiToolBridge({
      engine: request.engine,
      context: request.context,
      workspaceId: request.workspaceId ?? '',
      executionMode: request.executionMode,
      abortSignal: request.abortSignal,
      onClarificationRequest: request.onClarificationRequest,
      model: request.configuredModel ?? request.modelConfig.model,
      systemPrompt: request.systemPrompt,
    });

    const bridgeEnv = {
      ...toolBridge.env,
      ...(modelBridge?.env ?? {}),
    };

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
        extensionPaths: [extensionPath],
        // Disable pi's own read/bash/edit/write implementations so every
        // visible tool — including those names — goes through Engine policy.
        extraArgs: ['--no-builtin-tools', ...(modelBridge?.extraArgs ?? [])],
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
      try {
        result = await runOnce(sessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!sessionId || request.abortSignal.aborted || !RESUME_FAILURE_RE.test(message)) throw err;
        await clearExternalSessionId(request.chatSessionId, PI_NATIVE_STATE_ID);
        result = await runOnce(undefined);
      }
    } finally {
      await toolBridge.dispose();
    }

    if (result.sessionId) {
      await saveExternalSessionId(request.chatSessionId, stateRef, result.sessionId);
    }
    const message = { role: 'assistant' as const, content: result.text };
    request.recordResponseMessages([message]);
    return { resultText: result.text, toolCalls };
  },
};
