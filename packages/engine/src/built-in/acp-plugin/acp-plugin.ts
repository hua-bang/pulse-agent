import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { z } from 'zod';

import type { EnginePlugin, EnginePluginContext } from '../../plugin/EnginePlugin.js';
import type { Tool, ToolExecutionContext } from '../../shared/types.js';

const ACP_SERVICE_NAME = 'acpBridgeService';
const DEFAULT_TARGET = 'codex';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SESSION_STORE_PATH = path.join(homedir(), '.pulse-coder', 'acp', 'sessions.json');

interface AcpClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  initializePath: string;
  sessionNewPath: string;
  sessionPromptPath: string;
  sessionCancelPath: string;
  initializeOptional: boolean;
}

interface AcpSessionBinding {
  remoteSessionId: string;
  acpSessionId: string;
  target: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

interface AcpSessionStorePayload {
  sessions: Record<string, AcpSessionBinding>;
}

interface AcpSessionStore {
  initialize(): Promise<void>;
  get(remoteSessionId: string): Promise<AcpSessionBinding | null>;
  upsert(binding: Omit<AcpSessionBinding, 'createdAt' | 'updatedAt'>): Promise<AcpSessionBinding>;
  remove(remoteSessionId: string): Promise<void>;
}

const metadataSchema = z.record(z.string(), z.unknown()).optional();

const statusSchema = z.object({});
const bindSchema = z.object({
  target: z.string().min(1).optional().describe('Target agent for this ACP session, for example codex or claude-code.'),
  metadata: metadataSchema.describe('Optional ACP metadata payload.'),
  forceNewSession: z.boolean().optional().describe('If true, always create a fresh ACP session and replace current binding.'),
});
const promptSchema = z.object({
  prompt: z.string().min(1).describe('Prompt content sent to the bound ACP session.'),
  target: z.string().min(1).optional().describe('Optional target agent override for session binding.'),
  metadata: metadataSchema.describe('Optional ACP metadata payload.'),
  forceNewSession: z.boolean().optional().describe('If true, create a fresh ACP session before sending this prompt.'),
});
const cancelSchema = z.object({
  reason: z.string().optional().describe('Optional cancel reason for ACP session/cancel.'),
  dropBinding: z.boolean().optional().describe('When true, remove local session binding after cancel succeeds.'),
});

type StatusInput = z.infer<typeof statusSchema>;
type BindInput = z.infer<typeof bindSchema>;
type PromptInput = z.infer<typeof promptSchema>;
type CancelInput = z.infer<typeof cancelSchema>;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function ensureLeadingSlash(value: string, fallback: string): string {
  const normalized = value.trim() || fallback;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function readStringField(payload: unknown, keys: string[]): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const source = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function extractSessionId(payload: unknown): string | null {
  const top = readStringField(payload, ['sessionId', 'session_id', 'id']);
  if (top) {
    return top;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const nestedData = (payload as Record<string, unknown>).data;
  const nested = readStringField(nestedData, ['sessionId', 'session_id', 'id']);
  return nested ?? null;
}

function extractText(payload: unknown): string {
  const top = readStringField(payload, ['text', 'output', 'result', 'answer', 'message']);
  if (top) {
    return top;
  }

  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const nestedData = (payload as Record<string, unknown>).data;
  return readStringField(nestedData, ['text', 'output', 'result', 'answer', 'message']) ?? '';
}

function extractFinishReason(payload: unknown): string | undefined {
  const top = readStringField(payload, ['finishReason', 'finish_reason']);
  if (top) {
    return top;
  }

  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const nestedData = (payload as Record<string, unknown>).data;
  return readStringField(nestedData, ['finishReason', 'finish_reason']);
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

function readRunContextString(runContext: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!runContext) {
    return undefined;
  }

  const value = runContext[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function resolveRunContextSessionId(context?: ToolExecutionContext): string {
  const runContext = context?.runContext as Record<string, unknown> | undefined;
  const sessionId = readRunContextString(runContext, 'sessionId') ?? readRunContextString(runContext, 'session_id');
  if (!sessionId) {
    throw new Error('ACP tools require runContext.sessionId.');
  }
  return sessionId;
}

function buildMetadata(
  runContext: Record<string, unknown> | undefined,
  inputMetadata?: Record<string, unknown>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(inputMetadata ?? {}),
  };

  const sessionId = readRunContextString(runContext, 'sessionId') ?? readRunContextString(runContext, 'session_id');
  const platformKey = readRunContextString(runContext, 'platformKey');
  const ownerKey = readRunContextString(runContext, 'ownerKey');

  if (sessionId) {
    metadata.remoteSessionId = sessionId;
  }
  if (platformKey) {
    metadata.platformKey = platformKey;
  }
  if (ownerKey) {
    metadata.ownerKey = ownerKey;
  }

  return metadata;
}

function buildClientConfigFromEnv(env: NodeJS.ProcessEnv): AcpClientConfig {
  return {
    baseUrl: trimSlash(env.ACP_BRIDGE_BASE_URL?.trim() ?? ''),
    apiKey: env.ACP_BRIDGE_API_KEY?.trim() || undefined,
    timeoutMs: parsePositiveInteger(env.ACP_BRIDGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    initializePath: ensureLeadingSlash(env.ACP_INITIALIZE_PATH ?? '', '/initialize'),
    sessionNewPath: ensureLeadingSlash(env.ACP_SESSION_NEW_PATH ?? '', '/session/new'),
    sessionPromptPath: ensureLeadingSlash(env.ACP_SESSION_PROMPT_PATH ?? '', '/session/prompt'),
    sessionCancelPath: ensureLeadingSlash(env.ACP_SESSION_CANCEL_PATH ?? '', '/session/cancel'),
    initializeOptional: parseBoolean(env.ACP_INITIALIZE_OPTIONAL, true),
  };
}

class FileAcpSessionStore implements AcpSessionStore {
  private readonly filePath: string;

  private initialized = false;

  private sessions = new Map<string, AcpSessionBinding>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as AcpSessionStorePayload;
      if (parsed && parsed.sessions && typeof parsed.sessions === 'object') {
        for (const value of Object.values(parsed.sessions)) {
          if (
            value
            && typeof value.remoteSessionId === 'string'
            && typeof value.acpSessionId === 'string'
            && typeof value.target === 'string'
          ) {
            this.sessions.set(value.remoteSessionId, value);
          }
        }
      }
    } catch {
      // Ignore missing/invalid file and start with empty state.
    }

    this.initialized = true;
  }

  async get(remoteSessionId: string): Promise<AcpSessionBinding | null> {
    await this.initialize();
    return this.sessions.get(remoteSessionId) ?? null;
  }

  async upsert(binding: Omit<AcpSessionBinding, 'createdAt' | 'updatedAt'>): Promise<AcpSessionBinding> {
    await this.initialize();
    const now = Date.now();
    const existing = this.sessions.get(binding.remoteSessionId);

    const next: AcpSessionBinding = {
      ...binding,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.sessions.set(binding.remoteSessionId, next);
    await this.persist();
    return next;
  }

  async remove(remoteSessionId: string): Promise<void> {
    await this.initialize();
    if (!this.sessions.delete(remoteSessionId)) {
      return;
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    const payload: AcpSessionStorePayload = {
      sessions: Object.fromEntries(this.sessions.entries()),
    };

    await fs.writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}

class AcpHttpClient {
  private readonly config: AcpClientConfig;

  private initializePromise: Promise<void> | null = null;

  constructor(config: AcpClientConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config.baseUrl.length > 0;
  }

  getStatus(): { configured: boolean; baseUrl?: string; timeoutMs: number } {
    if (!this.isConfigured()) {
      return { configured: false, timeoutMs: this.config.timeoutMs };
    }

    return {
      configured: true,
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
    };
  }

  async ensureInitialized(): Promise<void> {
    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }

    this.initializePromise = this.initializeInternal();
    await this.initializePromise;
  }

  async createSession(input: { target: string; metadata?: Record<string, unknown> }): Promise<{ sessionId: string; raw: unknown }> {
    await this.ensureInitialized();
    const payload = await this.postJson(this.config.sessionNewPath, {
      target: input.target,
      metadata: input.metadata ?? {},
    });

    const sessionId = extractSessionId(payload);
    if (!sessionId) {
      throw new Error('ACP session/new response missing session id');
    }

    return { sessionId, raw: payload };
  }

  async prompt(input: {
    sessionId: string;
    prompt: string;
    target?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ text: string; finishReason?: string; raw: unknown }> {
    await this.ensureInitialized();
    const payload = await this.postJson(this.config.sessionPromptPath, {
      sessionId: input.sessionId,
      session_id: input.sessionId,
      target: input.target,
      prompt: input.prompt,
      metadata: input.metadata ?? {},
    });

    return {
      text: extractText(payload),
      finishReason: extractFinishReason(payload),
      raw: payload,
    };
  }

  async cancel(input: { sessionId: string; reason?: string }): Promise<{ ok: boolean; raw: unknown }> {
    await this.ensureInitialized();
    const payload = await this.postJson(this.config.sessionCancelPath, {
      sessionId: input.sessionId,
      session_id: input.sessionId,
      reason: input.reason,
    });

    return { ok: true, raw: payload };
  }

  private async initializeInternal(): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('ACP bridge is not configured. Set ACP_BRIDGE_BASE_URL.');
    }

    try {
      await this.postJson(this.config.initializePath, {
        client: {
          name: 'pulse-coder-engine/built-in-acp',
          version: '0.1.0',
        },
        capabilities: {
          session: ['new', 'prompt', 'cancel'],
        },
      });
    } catch (error) {
      if (!this.config.initializeOptional) {
        throw error;
      }
      console.warn('[ACP] initialize failed, continuing in optional mode:', error);
    }
  }

  private async postJson(pathname: string, payload: unknown): Promise<unknown> {
    if (!this.isConfigured()) {
      throw new Error('ACP bridge is not configured. Set ACP_BRIDGE_BASE_URL.');
    }

    const url = `${this.config.baseUrl}${pathname}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (this.config.apiKey) {
        headers.authorization = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const rawText = await response.text();
      const parsed = rawText ? safeJsonParse(rawText) : {};

      if (!response.ok) {
        const preview = rawText.slice(0, 300);
        throw new Error(`ACP request failed: ${response.status} ${response.statusText}; body=${preview}`);
      }

      return parsed;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

class AcpBridgeService {
  private readonly client: AcpHttpClient;

  private readonly sessionStore: AcpSessionStore;

  private readonly defaultTarget: string;

  constructor(input: {
    client: AcpHttpClient;
    sessionStore: AcpSessionStore;
    defaultTarget: string;
  }) {
    this.client = input.client;
    this.sessionStore = input.sessionStore;
    this.defaultTarget = input.defaultTarget;
  }

  getStatus(): { configured: boolean; baseUrl?: string; timeoutMs: number; defaultTarget: string } {
    return {
      ...this.client.getStatus(),
      defaultTarget: this.defaultTarget,
    };
  }

  async ensureBoundSession(input: {
    remoteSessionId: string;
    target?: string;
    metadata?: Record<string, unknown>;
    forceNewSession?: boolean;
  }): Promise<{ binding: AcpSessionBinding; reused: boolean }> {
    this.assertConfigured();
    const existing = await this.sessionStore.get(input.remoteSessionId);
    const requestedTarget = this.resolveTarget(input.target, existing?.target);

    if (existing && !input.forceNewSession && existing.target === requestedTarget) {
      return { binding: existing, reused: true };
    }

    const created = await this.client.createSession({
      target: requestedTarget,
      metadata: input.metadata,
    });

    const binding = await this.sessionStore.upsert({
      remoteSessionId: input.remoteSessionId,
      acpSessionId: created.sessionId,
      target: requestedTarget,
      metadata: input.metadata,
    });

    return {
      binding,
      reused: false,
    };
  }

  async promptWithBoundSession(input: {
    remoteSessionId: string;
    prompt: string;
    target?: string;
    metadata?: Record<string, unknown>;
    forceNewSession?: boolean;
  }): Promise<{
    binding: AcpSessionBinding;
    reusedSession: boolean;
    text: string;
    finishReason?: string;
    raw: unknown;
  }> {
    const session = await this.ensureBoundSession({
      remoteSessionId: input.remoteSessionId,
      target: input.target,
      metadata: input.metadata,
      forceNewSession: input.forceNewSession,
    });

    const prompted = await this.client.prompt({
      sessionId: session.binding.acpSessionId,
      prompt: input.prompt,
      target: session.binding.target,
      metadata: input.metadata,
    });

    return {
      binding: session.binding,
      reusedSession: session.reused,
      text: prompted.text,
      finishReason: prompted.finishReason,
      raw: prompted.raw,
    };
  }

  async cancelBoundSession(input: {
    remoteSessionId: string;
    reason?: string;
    dropBinding?: boolean;
  }): Promise<{
    found: boolean;
    canceled: boolean;
    binding?: AcpSessionBinding;
    raw?: unknown;
  }> {
    this.assertConfigured();
    const binding = await this.sessionStore.get(input.remoteSessionId);
    if (!binding) {
      return {
        found: false,
        canceled: false,
      };
    }

    const canceled = await this.client.cancel({
      sessionId: binding.acpSessionId,
      reason: input.reason,
    });

    if (input.dropBinding) {
      await this.sessionStore.remove(input.remoteSessionId);
    }

    return {
      found: true,
      canceled: true,
      binding,
      raw: canceled.raw,
    };
  }

  private resolveTarget(primary?: string, fallback?: string): string {
    const fromPrimary = primary?.trim();
    if (fromPrimary) {
      return fromPrimary;
    }

    const fromFallback = fallback?.trim();
    if (fromFallback) {
      return fromFallback;
    }

    const fromDefault = this.defaultTarget.trim();
    if (fromDefault) {
      return fromDefault;
    }

    throw new Error('ACP target is missing. Provide target or set ACP_DEFAULT_TARGET.');
  }

  private assertConfigured(): void {
    if (!this.client.isConfigured()) {
      throw new Error('ACP bridge is not configured. Set ACP_BRIDGE_BASE_URL first.');
    }
  }
}

function createAcpStatusTool(service: AcpBridgeService): Tool<StatusInput, {
  ok: true;
  configured: boolean;
  baseUrl?: string;
  timeoutMs: number;
  defaultTarget: string;
}> {
  return {
    name: 'acp_status',
    description: 'Check ACP bridge readiness and defaults.',
    defer_loading: true,
    inputSchema: statusSchema,
    execute: async () => {
      const status = service.getStatus();
      return {
        ok: true,
        configured: status.configured,
        baseUrl: status.baseUrl,
        timeoutMs: status.timeoutMs,
        defaultTarget: status.defaultTarget,
      };
    },
  };
}

function createAcpSessionBindTool(service: AcpBridgeService): Tool<BindInput, {
  ok: true;
  remoteSessionId: string;
  acpSessionId: string;
  target: string;
  reusedSession: boolean;
}> {
  return {
    name: 'acp_session_bind',
    description: 'Create or reuse an ACP session bound to current run session.',
    defer_loading: true,
    inputSchema: bindSchema,
    execute: async (input, context) => {
      const runContext = context?.runContext as Record<string, unknown> | undefined;
      const remoteSessionId = resolveRunContextSessionId(context);
      const ensured = await service.ensureBoundSession({
        remoteSessionId,
        target: input.target,
        metadata: buildMetadata(runContext, input.metadata),
        forceNewSession: input.forceNewSession,
      });

      return {
        ok: true,
        remoteSessionId,
        acpSessionId: ensured.binding.acpSessionId,
        target: ensured.binding.target,
        reusedSession: ensured.reused,
      };
    },
  };
}

function createAcpPromptTool(service: AcpBridgeService): Tool<PromptInput, {
  ok: true;
  remoteSessionId: string;
  acpSessionId: string;
  target: string;
  reusedSession: boolean;
  finishReason?: string;
  text: string;
}> {
  return {
    name: 'acp_prompt',
    description: 'Send prompt to ACP-bound target agent (for example Codex or Claude Code).',
    defer_loading: true,
    inputSchema: promptSchema,
    execute: async (input, context) => {
      const runContext = context?.runContext as Record<string, unknown> | undefined;
      const remoteSessionId = resolveRunContextSessionId(context);
      const prompted = await service.promptWithBoundSession({
        remoteSessionId,
        prompt: input.prompt,
        target: input.target,
        metadata: buildMetadata(runContext, input.metadata),
        forceNewSession: input.forceNewSession,
      });

      return {
        ok: true,
        remoteSessionId,
        acpSessionId: prompted.binding.acpSessionId,
        target: prompted.binding.target,
        reusedSession: prompted.reusedSession,
        finishReason: prompted.finishReason,
        text: prompted.text,
      };
    },
  };
}

function createAcpCancelTool(service: AcpBridgeService): Tool<CancelInput, {
  ok: true;
  remoteSessionId: string;
  foundBinding: boolean;
  canceled: boolean;
  droppedBinding: boolean;
}> {
  return {
    name: 'acp_cancel',
    description: 'Cancel ACP session mapped to current run session.',
    defer_loading: true,
    inputSchema: cancelSchema,
    execute: async (input, context) => {
      const remoteSessionId = resolveRunContextSessionId(context);
      const canceled = await service.cancelBoundSession({
        remoteSessionId,
        reason: input.reason,
        dropBinding: input.dropBinding,
      });

      return {
        ok: true,
        remoteSessionId,
        foundBinding: canceled.found,
        canceled: canceled.canceled,
        droppedBinding: Boolean(input.dropBinding && canceled.found),
      };
    },
  };
}

export const builtInAcpPlugin: EnginePlugin = {
  name: 'pulse-coder-engine/built-in-acp',
  version: '0.1.0',
  async initialize(context: EnginePluginContext) {
    const client = new AcpHttpClient(buildClientConfigFromEnv(process.env));
    const storePath = process.env.ACP_SESSION_STORE_PATH?.trim() || DEFAULT_SESSION_STORE_PATH;
    const sessionStore = new FileAcpSessionStore(storePath);
    const defaultTarget = process.env.ACP_DEFAULT_TARGET?.trim() || DEFAULT_TARGET;
    const service = new AcpBridgeService({
      client,
      sessionStore,
      defaultTarget,
    });

    await sessionStore.initialize();

    context.registerService(ACP_SERVICE_NAME, service);
    context.registerTool('acp_status', createAcpStatusTool(service));
    context.registerTool('acp_session_bind', createAcpSessionBindTool(service));
    context.registerTool('acp_prompt', createAcpPromptTool(service));
    context.registerTool('acp_cancel', createAcpCancelTool(service));

    const status = service.getStatus();
    context.logger.info(
      `[ACP] plugin ready configured=${status.configured} baseUrl=${status.baseUrl ?? '(unset)'} defaultTarget=${status.defaultTarget}`,
    );
  },
};

export default builtInAcpPlugin;
