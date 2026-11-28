import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PulseStorage } from '@pulse-coder/storage';
import { Engine, type Context } from 'pulse-coder-engine';
import { readJsonBody, sendJson } from './auth.js';
import { appendConversationMessages, extractStoredMessages, type StoredChatMessage } from './agent-conversation-store.js';
import { AgentRunHub, type AgentRunContext } from './agent-runs.js';
import { summarizeCanvasForPrompt } from './agent-canvas-tools.js';
import { createVpsEngineTools } from './agent-engine-tools.js';
import {
  buildVpsLlmProvider,
  resolveAgentLlmConfig,
  saveAgentLlmConfigToEnvFile,
  type AgentLlmOverride,
} from './agent-llm.js';
import { listVpsSkills } from './agent-skills.js';
import type { ChatRoomHub } from './chat-room.js';
import {
  canUseRuntime,
  isSafeWorkspaceId,
  resolvePrincipalName,
  scopeClientId,
  type AuthPrincipal,
} from './shares.js';

const MAX_HISTORY_MESSAGES = 48;
const MAX_TOOL_OUTPUT_CHARS = 16_000;

export interface VpsAgentController {
  handleRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    principal: AuthPrincipal,
  ) => Promise<boolean>;
  close: () => void;
}

function serializeToolOutput(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (raw.length <= MAX_TOOL_OUTPUT_CHARS) return raw;
  return `${raw.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n... [truncated ${raw.length - MAX_TOOL_OUTPUT_CHARS} chars]`;
}

export function createVpsAgentController(options: {
  storage: PulseStorage;
  workDir: string;
  chatRoomHub: ChatRoomHub;
  onMutation?: () => void;
}): VpsAgentController {
  const { storage, workDir, chatRoomHub, onMutation } = options;
  const runs = new AgentRunHub({
    onSessionChange: (workspaceId, sessionId, active, queued) => {
      chatRoomHub.setRun(workspaceId, sessionId, active, queued);
    },
  });
  chatRoomHub.cancelRun = (workspaceId, runId) => (
    runs.get(runId)?.workspaceId === workspaceId && runs.abort(runId)
  );

  const tokenWorkspace = (principal: AuthPrincipal) => (
    principal.kind === 'share' ? principal.share.workspaceId : ''
  );

  async function executeRun(
    ctx: AgentRunContext,
    llmConfig: NonNullable<ReturnType<typeof resolveAgentLlmConfig>>,
  ): Promise<Record<string, unknown>> {
    const { workspaceId, sessionId, runId, prompt: userText, senderName, clientId } = ctx.info;
    ctx.emit('session', { sessionId, runId, provider: llmConfig.provider, model: llmConfig.model });

    const existingConv = await storage.conversations.read(workspaceId, sessionId).catch(() => null);
    const storedHistory = extractStoredMessages(existingConv);
    // The user turn is durable before the model runs, so peers that reload
    // mid-run see it and a daemon crash cannot lose it.
    await appendConversationMessages(storage, workspaceId, sessionId, [{
      role: 'user',
      content: userText,
      timestamp: Date.now(),
      senderName,
    }], userText);
    onMutation?.();

    const [skills, canvasSummary] = await Promise.all([
      listVpsSkills(workDir),
      summarizeCanvasForPrompt(storage, workspaceId),
    ]);
    const skillsSection =
      skills.length > 0
        ? `Available skills (call load_skill(name) before applying one):\n${skills
            .map((s) => `- ${s.name}: ${s.description}`)
            .join('\n')}`
        : 'No custom skills installed in .pulse-coder/skills.';
    const systemPrompt = [
      'You are Pulse Canvas Agent running directly on the remote VPS workspace.',
      `Workspace ID: ${workspaceId}`,
      `Working directory: ${workDir}`,
      canvasSummary,
      skillsSection,
      'Use environment tools (bash, read, write, edit, ls, grep) to inspect or run code in the workspace, and canvas_* tools to read or organize the Pulse Canvas.',
      'Be concise, direct, and reply in the user’s language.',
    ].join('\n\n');
    const context: Context = {
      messages: [
        ...storedHistory.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userText },
      ],
    };

    let fullAssistantText = '';
    const recordedTools: NonNullable<StoredChatMessage['toolCalls']> = [];
    const toolArgsById = new Map<string, Record<string, unknown>>();
    const toolNameById = new Map<string, string>();
    let toolSeq = 0;
    let lastRoomPushAt = 0;
    // Peers on older clients only read the room preview; keep it fed.
    const mirrorRoom = (toolName?: string, force = false) => {
      const now = Date.now();
      if (!force && now - lastRoomPushAt < 180) return;
      lastRoomPushAt = now;
      chatRoomHub.updateStream(workspaceId, sessionId, {
        clientId,
        senderName,
        prompt: userText,
        text: fullAssistantText,
        toolName,
      });
    };

    const persistReply = async (turnStatus?: 'stopped' | 'failed') => {
      // Tools still running when the turn ended never produced a result.
      const pending = [...toolNameById.entries()]
        .filter(([callId]) => !recordedTools.some((tool) => tool.toolCallId === callId))
        .map(([callId, name]) => ({
          id: ++toolSeq,
          name,
          args: toolArgsById.get(callId) ?? {},
          toolCallId: callId,
          status: 'cancelled' as const,
        }));
      const toolCalls = [...recordedTools, ...pending];
      if (!fullAssistantText && toolCalls.length === 0 && !turnStatus) return;
      await appendConversationMessages(storage, workspaceId, sessionId, [{
        role: 'assistant',
        content: fullAssistantText,
        timestamp: Date.now(),
        runId,
        ...(turnStatus ? { turnStatus } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      }], userText);
      onMutation?.();
    };

    try {
      const engine = new Engine({
        disableBuiltInPlugins: true,
        builtInTools: {},
        tools: createVpsEngineTools({ storage, workspaceId, workDir, signal: ctx.signal, onMutation }),
      });
      await engine.initialize();
      const engineText = await engine.run(context, {
        provider: buildVpsLlmProvider(llmConfig),
        model: llmConfig.model,
        systemPrompt,
        abortSignal: ctx.signal,
        errorMode: 'throw',
        promptCacheKey: `${llmConfig.provider}:${llmConfig.model}:${sessionId}`,
        onText: (delta) => {
          fullAssistantText += delta;
          ctx.emit('text_delta', { delta });
          mirrorRoom();
        },
        onToolCall: (toolCall: { toolCallId?: string; toolName?: string; input?: unknown; args?: unknown }) => {
          const callId = typeof toolCall?.toolCallId === 'string' ? toolCall.toolCallId : `call-${++toolSeq}`;
          const name = typeof toolCall?.toolName === 'string' ? toolCall.toolName : 'unknown';
          const rawArgs = toolCall?.input ?? toolCall?.args;
          const args =
            rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
              ? (rawArgs as Record<string, unknown>)
              : {};
          toolArgsById.set(callId, args);
          toolNameById.set(callId, name);
          ctx.emit('tool_call', { toolCallId: callId, name, args });
          mirrorRoom(name, true);
        },
        onToolResult: (toolResult: {
          toolCallId?: string;
          toolName?: string;
          output?: unknown;
          result?: unknown;
          isError?: boolean;
        }) => {
          const callId = typeof toolResult?.toolCallId === 'string' ? toolResult.toolCallId : '';
          const name = typeof toolResult?.toolName === 'string' ? toolResult.toolName : 'unknown';
          const rawOut = toolResult?.output ?? toolResult?.result;
          const isError = Boolean(toolResult?.isError);
          const serialized = serializeToolOutput(rawOut);
          const status = isError ? 'failed' : 'succeeded';
          const outcome = isError ? { error: serialized } : { result: serialized.slice(0, 4000) };
          recordedTools.push({
            id: ++toolSeq,
            name,
            args: toolArgsById.get(callId) ?? {},
            toolCallId: callId,
            status,
            ...outcome,
          });
          ctx.emit('tool_result', { toolCallId: callId, name, status, ...outcome });
        },
      });

      if (!fullAssistantText && engineText) fullAssistantText = engineText;
      const stopped = ctx.signal.aborted;
      await persistReply(stopped ? 'stopped' : undefined);
      return { ok: true, stopped, response: fullAssistantText };
    } catch (err) {
      const stopped = ctx.signal.aborted;
      const message = err instanceof Error ? err.message : String(err);
      // Keep the partial reply; losing it is worse than a failed marker.
      await persistReply(stopped ? 'stopped' : 'failed').catch(() => undefined);
      return { ok: false, stopped, response: fullAssistantText, error: stopped ? 'Aborted' : message };
    }
  }

  async function handleChat(
    req: IncomingMessage,
    res: ServerResponse,
    principal: AuthPrincipal,
  ): Promise<void> {
    if (!canUseRuntime(principal)) {
      sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Collaborator or admin role required for agent chat.' });
      return;
    }

    let body: {
      workspaceId?: string;
      sessionId?: string;
      message?: string;
      senderName?: string;
      clientId?: string;
      runId?: string;
      llm?: AgentLlmOverride;
    };
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const llmConfig = resolveAgentLlmConfig(body.llm);
    if (!llmConfig) {
      sendJson(res, 503, {
        ok: false,
        code: 'agent_not_configured',
        message: 'VPS Agent 尚未配置模型，请点击右上角「模型设置」填写 API Key 和模型。',
      });
      return;
    }

    const tokenWs = tokenWorkspace(principal);
    const requestedWs = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
    const workspaceId = tokenWs || requestedWs;
    if (!isSafeWorkspaceId(workspaceId) || (tokenWs && requestedWs && requestedWs !== tokenWs)) {
      sendJson(res, 400, { ok: false, error: 'Valid workspaceId is required.' });
      return;
    }

    const userText = typeof body.message === 'string' ? body.message.trim() : '';
    if (!userText) {
      sendJson(res, 400, { ok: false, error: 'message is required.' });
      return;
    }

    const sessionId =
      typeof body.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim().slice(0, 128)
        : `vps-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const requestedRunId = typeof body.runId === 'string' ? body.runId.trim().slice(0, 100) : '';
    const existingRun = requestedRunId ? runs.get(requestedRunId) : null;
    if (existingRun) {
      // A client retrying a start whose response was lost re-attaches instead of running twice.
      if (existingRun.workspaceId !== workspaceId || existingRun.sessionId !== sessionId) {
        sendJson(res, 409, { ok: false, code: 'run_id_conflict', error: 'runId is already used by another conversation.' });
        return;
      }
      runs.subscribe(req, res, requestedRunId, 0);
      return;
    }
    const runId = requestedRunId || randomUUID();
    const rawClientId =
      typeof body.clientId === 'string' && body.clientId.trim()
        ? body.clientId.trim().slice(0, 64)
        : `vps-agent-${principal.kind}`;

    const submitted = runs.submit({
      runId,
      workspaceId,
      sessionId,
      clientId: scopeClientId(principal, rawClientId),
      senderName: resolvePrincipalName(principal, body.senderName),
      prompt: userText,
    }, (ctx) => executeRun(ctx, llmConfig));
    if ('error' in submitted) {
      sendJson(res, 429, { ok: false, code: 'queue_full', error: submitted.error });
      return;
    }
    // The response is only a subscriber: closing it never stops the run.
    runs.subscribe(req, res, runId, 0);
  }

  function handleRuns(req: IncomingMessage, res: ServerResponse, url: URL, principal: AuthPrincipal): boolean {
    const tokenWs = tokenWorkspace(principal);
    const visible = (workspaceId: string) => !tokenWs || tokenWs === workspaceId;

    if (url.pathname === '/v1/agent/runs') {
      const workspaceId = tokenWs || url.searchParams.get('workspaceId')?.trim() || '';
      const sessionId = url.searchParams.get('sessionId')?.trim() || '';
      if (!isSafeWorkspaceId(workspaceId) || !sessionId || !visible(workspaceId)) {
        sendJson(res, 400, { ok: false, error: 'Valid workspaceId and sessionId are required.' });
        return true;
      }
      const active = runs.activeRun(workspaceId, sessionId);
      sendJson(res, 200, {
        ok: true,
        active: active ? runs.snapshot(active.runId) : null,
        queued: runs.queued(workspaceId, sessionId),
      });
      return true;
    }

    const match = /^\/v1\/agent\/runs\/([^/]+)(\/events)?$/.exec(url.pathname);
    if (!match) return false;
    const runId = decodeURIComponent(match[1]);
    const info = runs.get(runId);
    if (!info || !visible(info.workspaceId)) {
      sendJson(res, 404, { ok: false, code: 'not_found', error: 'Run not found or expired.' });
      return true;
    }
    if (!match[2]) {
      sendJson(res, 200, { ok: true, run: runs.snapshot(runId) });
      return true;
    }
    const lastEventId = Number(req.headers['last-event-id']);
    const afterParam = Number(url.searchParams.get('after'));
    const after = Number.isFinite(afterParam) && afterParam > 0
      ? afterParam
      : Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : 0;
    runs.subscribe(req, res, runId, after);
    return true;
  }

  return {
    handleRequest: async (req, res, url, principal) => {
      if (req.method === 'GET' && url.pathname === '/v1/agent/status') {
        const cfg = resolveAgentLlmConfig();
        const skills = await listVpsSkills(workDir);
        sendJson(res, 200, {
          ok: true,
          configured: Boolean(cfg),
          ...(cfg ? { provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl } : {}),
          skillsCount: skills.length,
        });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/v1/agent/config') {
        if (principal.kind !== 'admin') {
          sendJson(res, 403, { ok: false, error: 'Admin token required to save VPS-wide model config.' });
          return true;
        }
        try {
          const body = await readJsonBody<AgentLlmOverride>(req);
          saveAgentLlmConfigToEnvFile(body);
          const cfg = resolveAgentLlmConfig();
          sendJson(res, 200, {
            ok: true,
            configured: Boolean(cfg),
            ...(cfg ? { provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl } : {}),
          });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/v1/agent/models') {
        if (!canUseRuntime(principal)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' });
          return true;
        }
        try {
          const body = await readJsonBody<AgentLlmOverride>(req);
          const cfg = resolveAgentLlmConfig(body);
          if (!cfg) {
            sendJson(res, 400, { ok: false, error: 'API Key is required to fetch models.' });
            return true;
          }
          const modelsUrl =
            cfg.provider === 'anthropic'
              ? cfg.baseUrl.endsWith('/v1/models')
                ? cfg.baseUrl
                : `${cfg.baseUrl}/v1/models`
              : cfg.baseUrl.endsWith('/models')
                ? cfg.baseUrl
                : `${cfg.baseUrl}/models`;
          const headers: Record<string, string> =
            cfg.provider === 'anthropic'
              ? { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }
              : { Authorization: `Bearer ${cfg.apiKey}` };
          const upstream = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(10_000) });
          if (!upstream.ok) {
            const text = await upstream.text().catch(() => '');
            sendJson(res, 502, {
              ok: false,
              error: `Upstream HTTP ${upstream.status}: ${text.slice(0, 200)}`,
            });
            return true;
          }
          const json = (await upstream.json()) as {
            data?: Array<{ id?: string; display_name?: string }>;
            models?: Array<{ id?: string; name?: string }>;
          };
          const rawList = Array.isArray(json.data)
            ? json.data.map((m) => m.id).filter((id): id is string => typeof id === 'string' && Boolean(id))
            : Array.isArray(json.models)
              ? json.models
                  .map((m) => m.id || m.name)
                  .filter((id): id is string => typeof id === 'string' && Boolean(id))
              : [];
          const models = Array.from(new Set(rawList)).sort((a, b) => a.localeCompare(b));
          sendJson(res, 200, { ok: true, models });
        } catch (err) {
          sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/v1/agent/skills') {
        const skills = await listVpsSkills(workDir);
        sendJson(res, 200, { ok: true, skills });
        return true;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/v1/agent/runs')) {
        if (!canUseRuntime(principal)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' });
          return true;
        }
        return handleRuns(req, res, url, principal);
      }

      if (req.method === 'POST' && url.pathname === '/v1/agent/abort') {
        if (!canUseRuntime(principal)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' });
          return true;
        }
        try {
          const body = await readJsonBody<{ workspaceId?: string; sessionId?: string; runId?: string }>(req);
          const wsId = tokenWorkspace(principal) || (body.workspaceId?.trim() ?? '');
          const sessionId = body.sessionId?.trim() ?? '';
          const requested = body.runId?.trim() ? runs.get(body.runId.trim()) : null;
          const target = requested?.workspaceId === wsId ? requested : runs.activeRun(wsId, sessionId);
          const aborted = target ? runs.abort(target.runId) : false;
          sendJson(res, 200, { ok: true, aborted, ...(target ? { runId: target.runId } : {}) });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/v1/agent/chat') {
        await handleChat(req, res, principal);
        return true;
      }

      return false;
    },
    close: () => {
      runs.close();
    },
  };
}
