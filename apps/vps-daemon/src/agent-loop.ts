import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PulseStorage } from '@pulse-coder/storage';
import { Engine, type Context } from 'pulse-coder-engine';
import { readJsonBody, sendJson } from './auth.js';
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

interface StoredChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  senderName?: string;
  toolCalls?: Array<{
    id: number;
    name: string;
    args?: Record<string, unknown>;
    toolCallId?: string;
    status: 'succeeded' | 'failed';
    result?: unknown;
    error?: string;
  }>;
}

function serializeToolOutput(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (raw.length <= MAX_TOOL_OUTPUT_CHARS) return raw;
  return `${raw.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n... [truncated ${raw.length - MAX_TOOL_OUTPUT_CHARS} chars]`;
}

function extractStoredMessages(raw: unknown): StoredChatMessage[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as { messages?: unknown[]; entries?: Array<{ data?: unknown }> };
  const list = Array.isArray(obj.messages)
    ? obj.messages
    : Array.isArray(obj.entries)
      ? obj.entries.map((e) => e?.data)
      : [];
  const out: StoredChatMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if ((rec.role === 'user' || rec.role === 'assistant') && typeof rec.content === 'string') {
      out.push({
        role: rec.role,
        content: rec.content,
        timestamp: typeof rec.timestamp === 'number' ? rec.timestamp : Date.now(),
        ...(typeof rec.senderName === 'string' ? { senderName: rec.senderName } : {}),
        ...(Array.isArray(rec.toolCalls) ? { toolCalls: rec.toolCalls as StoredChatMessage['toolCalls'] } : {}),
      });
    }
  }
  return out;
}

export function createVpsAgentController(options: {
  storage: PulseStorage;
  workDir: string;
  chatRoomHub: ChatRoomHub;
  onMutation?: () => void;
}): VpsAgentController {
  const { storage, workDir, chatRoomHub, onMutation } = options;
  const activeRuns = new Map<string, AbortController>();

  const runKey = (wsId: string, sessionId: string) => `${wsId}::${sessionId}`;

  async function persistConversation(
    workspaceId: string,
    sessionId: string,
    newMessages: StoredChatMessage[],
    totalCount: number,
    titleHint: string,
  ): Promise<void> {
    const existing = await storage.conversations.read(workspaceId, sessionId).catch(() => null);
    const prevMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const prevSession =
      prevMeta.session && typeof prevMeta.session === 'object' && !Array.isArray(prevMeta.session)
        ? (prevMeta.session as Record<string, unknown>)
        : {};
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const title = typeof prevMeta.title === 'string' && prevMeta.title ? prevMeta.title : titleHint.slice(0, 60);
    const startedAt = typeof prevSession.startedAt === 'string' ? prevSession.startedAt : nowIso;
    const lastContent = newMessages[newMessages.length - 1]?.content ?? '';
    await storage.conversations.commit({
      scopeId: workspaceId,
      sessionId,
      expectedRevision: existing?.revision ?? null,
      metadata: {
        ...prevMeta,
        session: {
          ...prevSession,
          sessionId,
          workspaceId,
          startedAt,
          title,
        },
        title,
        date: typeof prevMeta.date === 'string' ? prevMeta.date : startedAt.slice(0, 10),
        updatedAt: now,
        messageCount: totalCount,
        preview: lastContent.slice(0, 120),
      },
      appendMessages: newMessages.map((msg) =>
        JSON.parse(
          JSON.stringify({
            id: `msg-${randomUUID().slice(0, 8)}`,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            ...(msg.senderName ? { senderName: msg.senderName } : {}),
            ...(msg.toolCalls ? { toolCalls: msg.toolCalls } : {}),
          }),
        ),
      ),
    });
    const scope = await storage.conversationScopes.read(workspaceId).catch(() => null);
    await storage.conversationScopes.commit({
      scopeId: workspaceId,
      expectedRevision: scope?.revision ?? null,
      currentSessionId: sessionId,
    });
    onMutation?.();
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

    const tokenWs = principal.kind === 'share' ? principal.share.workspaceId : '';
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
    const runId = typeof body.runId === 'string' && body.runId.trim() ? body.runId.trim() : randomUUID();
    const senderName = resolvePrincipalName(principal, body.senderName);
    const rawClientId =
      typeof body.clientId === 'string' && body.clientId.trim()
        ? body.clientId.trim().slice(0, 64)
        : `vps-agent-${principal.kind}`;
    const clientId = scopeClientId(principal, rawClientId);

    const key = runKey(workspaceId, sessionId);
    const prevAbort = activeRuns.get(key);
    if (prevAbort) prevAbort.abort();
    const controller = new AbortController();
    activeRuns.set(key, controller);

    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once('close', onClose);
    req.once('aborted', onClose);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const writeSse = (event: string, data: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Ignore broken pipe.
      }
    };

    const existingConv = await storage.conversations.read(workspaceId, sessionId).catch(() => null);
    const storedHistory = extractStoredMessages(existingConv);
    const userMessage: StoredChatMessage = {
      role: 'user',
      content: userText,
      timestamp: Date.now(),
      senderName,
    };

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
        ...storedHistory.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: 'user', content: userText },
      ],
    };

    let fullAssistantText = '';
    const recordedTools: NonNullable<StoredChatMessage['toolCalls']> = [];
    const toolArgsById = new Map<string, Record<string, unknown>>();
    let toolSeq = 0;
    let lastRoomPushAt = 0;

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

    writeSse('session', { sessionId, runId, provider: llmConfig.provider, model: llmConfig.model });
    mirrorRoom(undefined, true);

    try {
      const engine = new Engine({
        disableBuiltInPlugins: true,
        builtInTools: {},
        tools: createVpsEngineTools({
          storage,
          workspaceId,
          workDir,
          signal: controller.signal,
          onMutation,
        }),
      });
      await engine.initialize();

      const engineText = await engine.run(context, {
        provider: buildVpsLlmProvider(llmConfig),
        model: llmConfig.model,
        systemPrompt,
        abortSignal: controller.signal,
        errorMode: 'throw',
        promptCacheKey: `${llmConfig.provider}:${llmConfig.model}:${sessionId}`,
        onText: (delta) => {
          fullAssistantText += delta;
          writeSse('text_delta', { delta });
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
          writeSse('tool_call', { toolCallId: callId, name, args });
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
          const errorText = isError
            ? typeof rawOut === 'string'
              ? rawOut
              : serializeToolOutput(rawOut)
            : undefined;
          const status = isError ? 'failed' : 'succeeded';
          const serialized = errorText ? errorText : serializeToolOutput(rawOut);
          recordedTools.push({
            id: ++toolSeq,
            name,
            args: toolArgsById.get(callId) ?? {},
            toolCallId: callId,
            status,
            ...(errorText ? { error: errorText } : { result: serialized.slice(0, 4000) }),
          });
          writeSse('tool_result', {
            toolCallId: callId,
            name,
            status,
            ...(errorText ? { error: errorText } : { result: serialized.slice(0, 4000) }),
          });
        },
      });

      if (!fullAssistantText && engineText) {
        fullAssistantText = engineText;
      }

      const stopped = controller.signal.aborted;
      const assistantMessage: StoredChatMessage = {
        role: 'assistant',
        content: fullAssistantText,
        timestamp: Date.now(),
        ...(recordedTools.length > 0 ? { toolCalls: recordedTools } : {}),
      };
      await persistConversation(
        workspaceId,
        sessionId,
        [userMessage, assistantMessage],
        storedHistory.length + 2,
        userText,
      );
      writeSse('complete', {
        ok: true,
        stopped,
        sessionId,
        runId,
        response: fullAssistantText,
      });
    } catch (err) {
      const stopped = controller.signal.aborted;
      const message = err instanceof Error ? err.message : String(err);
      writeSse('complete', {
        ok: false,
        stopped,
        sessionId,
        runId,
        response: fullAssistantText,
        error: stopped ? 'Aborted' : message,
      });
    } finally {
      if (activeRuns.get(key) === controller) activeRuns.delete(key);
      chatRoomHub.release(workspaceId, sessionId, clientId);
      res.off('close', onClose);
      req.off('aborted', onClose);
      if (!res.writableEnded) res.end();
    }
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

      if (req.method === 'POST' && url.pathname === '/v1/agent/abort') {
        if (!canUseRuntime(principal)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' });
          return true;
        }
        try {
          const body = await readJsonBody<{ workspaceId?: string; sessionId?: string }>(req);
          const tokenWs = principal.kind === 'share' ? principal.share.workspaceId : '';
          const wsId = tokenWs || (body.workspaceId?.trim() ?? '');
          const sessionId = body.sessionId?.trim() ?? '';
          const active = activeRuns.get(runKey(wsId, sessionId));
          if (active) active.abort();
          sendJson(res, 200, { ok: true, aborted: Boolean(active) });
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
      for (const ctrl of activeRuns.values()) ctrl.abort();
      activeRuns.clear();
    },
  };
}
