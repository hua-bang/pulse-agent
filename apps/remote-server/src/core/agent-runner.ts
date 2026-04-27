import { randomUUID } from 'crypto';
import { buildProvider, type CompactionEvent, type LLMProviderFactory } from 'pulse-coder-engine';
import type { ModelMessage } from 'ai';
import type { ClarificationRequest, IncomingAttachment } from './types.js';
import { engine } from './engine-singleton.js';
import { getAcpState, runAcp } from 'pulse-coder-acp';
import { sessionStore, type SessionLink } from './session-store.js';
import { buildAttachmentSystemPrompt, resolveIncomingAttachments } from './attachments.js';
import { memoryIntegration, recordDailyLogFromSuccessPath } from './memory-integration.js';
import { buildRemoteWorktreeRunContext, worktreeIntegration } from './worktree/integration.js';
import { buildRemoteVaultRunContext, vaultIntegration } from './vault/integration.js';
import { resolveModelForRun } from './model-config.js';
const ACP_CLIENT_INFO = {
  name: 'pulse-remote-server',
  title: 'Pulse Remote Server',
  version: '1.0.0',
};

export type CompactionSnapshot = CompactionEvent;

interface RunChannelInfo {
  platform: 'feishu' | 'discord' | 'telegram' | 'web' | 'internal' | 'unknown';
  kind?: 'group' | 'dm' | 'thread' | 'channel' | 'chat' | 'user' | 'internal';
  channelId?: string;
  userId?: string;
  isThread?: boolean;
}

export interface AgentTurnCallbacks {
  onText?: (delta: string) => void;
  onToolCall?: (toolCall: any) => void;
  onToolResult?: (toolResult: any) => void;
  onClarificationRequest?: (request: ClarificationRequest) => Promise<string>;
  onCompactionEvent?: (event: CompactionSnapshot) => void;
}

export interface ExecuteAgentTurnInput {
  runId?: string;
  platformKey: string;
  memoryKey: string;
  forceNewSession?: boolean;
  userText: string;
  source: 'dispatcher' | 'internal';
  attachments?: IncomingAttachment[];
  caller?: string;
  callerSelectors?: string[];
  abortSignal?: AbortSignal;
  callbacks?: AgentTurnCallbacks;
}

export interface ExecuteAgentTurnResult {
  runId: string;
  sessionId: string;
  resultText: string;
  compactions: CompactionSnapshot[];
}

function normalizeCallerSelectors(raw?: string[]): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized = raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  return [...new Set(normalized)];
}

function normalizeCaller(raw?: string): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function buildToolCallerContext(input: {
  caller?: string;
  callerSelectors?: string[];
}): { caller?: string; callerSelectors?: string[] } {
  const directCaller = normalizeCaller(input.caller);
  const selectors = normalizeCallerSelectors(input.callerSelectors);

  if (directCaller && !selectors.includes(directCaller)) {
    selectors.unshift(directCaller);
  }

  const resolvedCaller = directCaller ?? selectors[0];

  return {
    caller: resolvedCaller,
    callerSelectors: selectors.length > 0 ? selectors : undefined,
  };
}

function buildRunContext(input: {
  runId: string;
  sessionId: string;
  userText: string;
  platformKey: string;
  ownerKey?: string;
  caller?: string;
  callerSelectors?: string[];
  latestAttachments?: unknown[];
}): Record<string, any> {
  const channel = parseChannelInfo(input.platformKey);
  const callerContext = buildToolCallerContext({
    caller: input.caller,
    callerSelectors: input.callerSelectors,
  });

  return {
    runId: input.runId,
    sessionId: input.sessionId,
    userText: input.userText,
    platformKey: input.platformKey,
    ownerKey: input.ownerKey,
    channel: channel ?? undefined,
    caller: callerContext.caller,
    callerSelectors: callerContext.callerSelectors,
    latestAttachments: input.latestAttachments ?? [],
    attachments: input.latestAttachments ?? [],
  };
}

function parseChannelInfo(platformKey: string): RunChannelInfo | undefined {
  const normalized = platformKey.trim();
  if (!normalized) {
    return undefined;
  }

  const feishuGroup = /^feishu:group:([^:]+):([^:]+)$/.exec(normalized);
  if (feishuGroup) {
    return {
      platform: 'feishu',
      kind: 'group',
      channelId: feishuGroup[1],
      userId: feishuGroup[2],
    };
  }

  const feishuDm = /^feishu:([^:]+)$/.exec(normalized);
  if (feishuDm) {
    return {
      platform: 'feishu',
      kind: 'dm',
      channelId: feishuDm[1],
      userId: feishuDm[1],
    };
  }

  const discordThread = /^discord:thread:([^:]+)$/.exec(normalized);
  if (discordThread) {
    return {
      platform: 'discord',
      kind: 'thread',
      channelId: discordThread[1],
      isThread: true,
    };
  }

  const discordChannel = /^discord:channel:([^:]+):([^:]+)$/.exec(normalized);
  if (discordChannel) {
    return {
      platform: 'discord',
      kind: 'channel',
      channelId: discordChannel[1],
      userId: discordChannel[2],
      isThread: false,
    };
  }

  const discordDm = /^discord:([^:]+)$/.exec(normalized);
  if (discordDm) {
    return {
      platform: 'discord',
      kind: 'dm',
      userId: discordDm[1],
    };
  }

  const telegram = /^telegram:(.+)$/.exec(normalized);
  if (telegram) {
    return {
      platform: 'telegram',
      kind: 'chat',
      channelId: telegram[1],
    };
  }

  const web = /^web:(.+)$/.exec(normalized);
  if (web) {
    return {
      platform: 'web',
      kind: 'user',
      userId: web[1],
    };
  }

  const internal = /^internal:(.+)$/.exec(normalized);
  if (internal) {
    return {
      platform: 'internal',
      kind: 'internal',
      channelId: internal[1],
    };
  }

  return { platform: 'unknown' };
}

function buildChannelSystemPrompt(platformKey: string): string | null {
  const channel = parseChannelInfo(platformKey);
  if (!channel || (channel.platform !== 'discord' && channel.platform !== 'feishu')) {
    return null;
  }

  const lines = [
    'Channel context:',
    `platform=${channel.platform}`,
    channel.kind ? `kind=${channel.kind}` : '',
    channel.channelId ? `channelId=${channel.channelId}` : '',
  ].filter(Boolean);

  if (lines.length <= 1) {
    return null;
  }

  return lines.join('\n');
}

function resolveRunProvider(
  modelType: 'openai' | 'claude' | undefined,
  platformKey: string,
  overrides?: { baseURL?: string; apiKey?: string; headers?: Record<string, string> },
): LLMProviderFactory | undefined {
  // 只要配置里给了任意 provider 级别的覆盖（含 modelType / baseURL / apiKey / headers），
  // 就显式构造 provider；否则保持 undefined，让 engine 走 env 兜底。
  const hasOverride =
    !!modelType ||
    !!overrides?.baseURL ||
    !!overrides?.apiKey ||
    !!(overrides?.headers && Object.keys(overrides.headers).length > 0);
  if (!hasOverride) return undefined;

  const type: 'openai' | 'claude' = modelType ?? 'openai';
  const headers: Record<string, string> = {
    ...(type === 'claude' ? { 'x-session-id': platformKey } : {}),
    ...(overrides?.headers ?? {}),
  };

  return buildProvider(type, {
    baseURL: overrides?.baseURL,
    apiKey: overrides?.apiKey,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
}

function formatLinkedAt(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

function buildLinkedSessionsIndex(links: SessionLink[]): string | null {
  if (links.length === 0) {
    return null;
  }

  const header = [
    '## Linked Sessions',
    'This session has linked sessions for reference. Use the read_linked_session tool to read their content when the user asks or when you need context from them.',
    '',
  ];

  const entries = links.map((link, i) => {
    const label = link.label ? ` "${link.label}"` : '';
    return `${i + 1}. ${link.sessionId}${label} (linked ${formatLinkedAt(link.linkedAt)})`;
  });

  return [...header, ...entries].join('\n');
}

export async function executeAgentTurn(input: ExecuteAgentTurnInput): Promise<ExecuteAgentTurnResult> {
  const session = await sessionStore.getOrCreate(input.platformKey, input.forceNewSession, input.memoryKey);
  const sessionId = session.sessionId;
  const runId = input.runId ?? randomUUID();
  const context = session.context;
  const callbacks = input.callbacks ?? {};
  const compactions: CompactionSnapshot[] = [];
  const { model: modelOverride, modelType, baseURL, apiKey, headers } = await resolveModelForRun(input.platformKey);
  const providerOverride = resolveRunProvider(modelType, input.platformKey, { baseURL, apiKey, headers });

  let latestAttachments = session.latestAttachments ?? [];
  if (input.attachments?.length) {
    const resolved = await resolveIncomingAttachments({
      platformKey: input.platformKey,
      ownerKey: input.memoryKey,
      attachments: input.attachments,
    });
    if (resolved.hadImageAttachments) {
      latestAttachments = resolved.attachments;
      await sessionStore.setLatestAttachments(sessionId, latestAttachments);
    }
    if (resolved.errors.length > 0) {
      console.warn(`[agent-runner] Attachment download errors for ${input.platformKey}:`, resolved.errors);
    }
  }

  const attachmentPrompt = buildAttachmentSystemPrompt(latestAttachments);

  context.messages.push({ role: 'user', content: input.userText });

  const runContext = buildRunContext({
    runId,
    sessionId,
    userText: input.userText,
    platformKey: input.platformKey,
    ownerKey: input.memoryKey,
    caller: input.caller,
    callerSelectors: input.callerSelectors,
    latestAttachments,
  });

  // Inject model into runContext so observability plugins (e.g. langfuse) can
  // attach it to generations without requiring engine-level changes.
  // Fall back to env vars so the model name is always present even when no
  // model-config.json is configured.
  runContext.model =
    modelOverride ??
    process.env.ANTHROPIC_MODEL ??
    process.env.OPENAI_MODEL ??
    process.env.PULSE_ANTHROPIC_MODEL ??
    process.env.PULSE_OPENAI_MODEL ??
    'novita/deepseek/deepseek_v3';

  const acpState = await getAcpState(input.platformKey);
  const linkedSessions = await sessionStore.getLinkedSessionsForSession(sessionId);

  const resultText = await runWithAgentContexts(
    {
      platformKey: input.platformKey,
      memoryKey: input.memoryKey,
      sessionId,
      userText: input.userText,
      source: input.source,
    },
    async () => {
      if (acpState) {
        const result = await runAcp({
          platformKey: input.platformKey,
          agent: acpState.agent,
          cwd: acpState.cwd,
          sessionId: acpState.sessionId,
          userText: input.userText,
          abortSignal: input.abortSignal,
          clientInfo: ACP_CLIENT_INFO,
          callbacks: {
            onText: callbacks.onText,
            onToolCall: callbacks.onToolCall,
            onToolResult: callbacks.onToolResult,
            onClarificationRequest: callbacks.onClarificationRequest,
          },
        });
        return result.text;
      }

      console.log('modelType', modelType);

      return engine.run(context, {
        provider: providerOverride,
        model: modelOverride,
        modelType,
        runContext,
        systemPrompt: (() => {
          const channelPrompt = buildChannelSystemPrompt(input.platformKey);
          const linkedPrompt = buildLinkedSessionsIndex(linkedSessions);
          const parts = [channelPrompt, attachmentPrompt, linkedPrompt].filter(Boolean) as string[];
          if (parts.length === 0) {
            return undefined;
          }
          return { append: `\n${parts.join('\n\n')}` };
        })(),
        abortSignal: input.abortSignal,
        onText: callbacks.onText,
        onToolCall: callbacks.onToolCall,
        onToolResult: callbacks.onToolResult,
        onResponse: (messages: ModelMessage[]) => {
          for (const msg of messages) {
            context.messages.push(msg);
          }
        },
        onCompacted: (newMessages: ModelMessage[], event: CompactionSnapshot | undefined) => {
          if (event) {
            compactions.push(event);
            callbacks.onCompactionEvent?.(event);
          }
          context.messages = newMessages;
        },
        onClarificationRequest: callbacks.onClarificationRequest,
      });
    },
  );

  await sessionStore.save(sessionId, context);
  await recordDailyLogFromSuccessPath({
    platformKey: input.memoryKey,
    sessionId,
    userText: input.userText,
    assistantText: resultText,
    source: input.source,
  });

  return {
    runId,
    sessionId,
    resultText,
    compactions,
  };
}

export async function runWithAgentContexts<T>(
  input: {
    platformKey: string;
    memoryKey: string;
    sessionId: string;
    userText: string;
    source: string;
  },
  run: () => Promise<T>,
): Promise<T> {
  return worktreeIntegration.withRunContext(
    buildRemoteWorktreeRunContext(input.platformKey),
    async () => vaultIntegration.withRunContext(
      buildRemoteVaultRunContext(input.platformKey),
      async () => memoryIntegration.withRunContext(
        {
          platformKey: input.memoryKey,
          sessionId: input.sessionId,
          userText: input.userText,
        },
        run,
      ),
    ),
  );
}

export function formatCompactionEvents(events: CompactionSnapshot[]): string {
  return events
    .map((event) => {
      const reason = event.reason ?? event.strategy;
      return `#${event.attempt} ${event.trigger} ${reason} msgs:${event.beforeMessageCount}->${event.afterMessageCount} tokens:${event.beforeEstimatedTokens}->${event.afterEstimatedTokens}`;
    })
    .join(' | ');
}
