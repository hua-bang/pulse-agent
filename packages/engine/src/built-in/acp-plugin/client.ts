import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { homedir } from 'os';
import path from 'path';

import type {
  AcpCancelInput,
  AcpClient,
  AcpClientConfig,
  AcpClientStatus,
  AcpNewSessionInput,
  AcpNewSessionResult,
  AcpPromptInput,
  AcpPromptResult,
  AcpStdioConfig,
  AcpTransport,
  AcpBridgeStatus,
  AcpSessionBinding,
  AcpSessionStore,
  EnsureSessionInput,
  EnsureSessionResult,
} from './types';

export const ACP_SERVICE_NAME = 'acpBridgeService';
export const DEFAULT_TARGET = 'codex';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_SESSION_STORE_PATH = path.join(homedir(), '.pulse-coder', 'acp', 'sessions.json');

export class AcpBridgeService {
  private readonly client: AcpClient;

  private readonly sessionStore: AcpSessionStore;

  private readonly defaultTarget: string;

  constructor(input: {
    client: AcpClient;
    sessionStore: AcpSessionStore;
    defaultTarget: string;
  }) {
    this.client = input.client;
    this.sessionStore = input.sessionStore;
    this.defaultTarget = input.defaultTarget;
  }

  getStatus(): AcpBridgeStatus {
    return {
      ...this.client.getStatus(),
      defaultTarget: this.defaultTarget,
    };
  }

  async ensureBoundSession(input: EnsureSessionInput): Promise<EnsureSessionResult> {
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

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

interface PendingRequest {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

interface JsonRpcClientOptions {
  timeoutMs: number;
  name: string;
}

class StdioJsonRpcClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly emitter = new EventEmitter();
  private buffer = '';
  private closed = false;
  private readonly proc;

  constructor(
    command: string,
    args: string[] | undefined,
    env: Record<string, string> | undefined,
    cwd: string | undefined,
    options: JsonRpcClientOptions,
  ) {
    this.proc = spawn(command, args ?? [], {
      env: env ? { ...process.env, ...env } : process.env,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => this.handleStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', chunk => {
      this.emitter.emit('stderr', chunk);
    });
    this.proc.on('close', (code, signal) => {
      this.closed = true;
      this.rejectAll(new Error(`[${options.name}] ACP stdio exited: code=${code ?? 'null'} signal=${signal ?? 'null'}`));
    });
    this.proc.on('error', error => {
      this.closed = true;
      this.rejectAll(error);
    });
  }

  on(event: 'notification' | 'stderr', listener: (payload: unknown) => void) {
    this.emitter.on(event, listener);
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcResponse> {
    if (this.closed) {
      return Promise.reject(new Error('ACP stdio process is closed'));
    }

    const id = randomUUID();
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const serialized = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP stdio request timeout for ${method}`));
      }, timeoutMs) : undefined;

      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(`${serialized}\n`);
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.proc.stdin.end();
    this.proc.kill();
    this.rejectAll(new Error('ACP stdio client closed'));
  }

  private handleStdout(chunk: string) {
    this.buffer += chunk;
    let lineEnd = this.buffer.indexOf('\n');

    while (lineEnd >= 0) {
      const line = this.buffer.slice(0, lineEnd).trim();
      this.buffer = this.buffer.slice(lineEnd + 1);

      if (line) {
        this.handleMessageLine(line);
      }

      lineEnd = this.buffer.indexOf('\n');
    }
  }

  private handleMessageLine(line: string) {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emitter.emit('stderr', `[ACP stdio] Invalid JSON: ${line}`);
      return;
    }

    if ('id' in message && message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      if (pending.timer) {
        clearTimeout(pending.timer);
      }

      if ('error' in message && message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message as JsonRpcResponse);
      }

      return;
    }

    this.emitter.emit('notification', message);
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }
}

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

function parseArgs(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  return parsed.length ? parsed : undefined;
}

function parseEnvPairs(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  const entries = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(pair => {
      const [key, ...rest] = pair.split('=');
      const normalizedKey = key?.trim();
      if (!normalizedKey) {
        return null;
      }
      return [normalizedKey, rest.join('=').trim()];
    })
    .filter(Boolean) as Array<[string, string]>;

  if (!entries.length) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

export function buildClientConfigFromEnv(env: NodeJS.ProcessEnv): AcpClientConfig {
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

export function buildStdioConfigFromEnv(env: NodeJS.ProcessEnv): AcpStdioConfig {
  return {
    command: env.ACP_STDIO_COMMAND?.trim() || '',
    args: parseArgs(env.ACP_STDIO_ARGS),
    env: parseEnvPairs(env.ACP_STDIO_ENV),
    cwd: env.ACP_STDIO_CWD?.trim() || undefined,
    timeoutMs: parsePositiveInteger(env.ACP_STDIO_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

export function resolveAcpTransport(env: NodeJS.ProcessEnv): AcpTransport {
  const explicit = env.ACP_TRANSPORT?.trim().toLowerCase();
  if (explicit === 'stdio' || explicit === 'http') {
    return explicit;
  }

  if (env.ACP_STDIO_COMMAND && env.ACP_STDIO_COMMAND.trim()) {
    return 'stdio';
  }

  return 'http';
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

export class AcpHttpClient {
  private readonly config: AcpClientConfig;

  private initializePromise: Promise<void> | null = null;

  constructor(config: AcpClientConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config.baseUrl.length > 0;
  }

  getStatus(): AcpClientStatus {
    if (!this.isConfigured()) {
      return { configured: false, timeoutMs: this.config.timeoutMs, transport: 'http' };
    }

    return {
      configured: true,
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
      transport: 'http',
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

  async createSession(input: AcpNewSessionInput): Promise<AcpNewSessionResult> {
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

  async prompt(input: AcpPromptInput): Promise<AcpPromptResult> {
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

  async cancel(input: AcpCancelInput): Promise<{ ok: boolean; raw: unknown }> {
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

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function extractTextFromNotification(notification: JsonRpcNotification): string | undefined {
  if (notification.method !== 'session/update') {
    return undefined;
  }

  const params = notification.params as Record<string, unknown> | undefined;
  if (!params) {
    return undefined;
  }

  const text = toOptionalString(params.text) ?? toOptionalString((params as any).message);
  if (text) {
    return text;
  }

  const data = params.data as Record<string, unknown> | undefined;
  return toOptionalString(data?.text) ?? toOptionalString((data as any)?.message);
}

function extractFinishReasonFromNotification(notification: JsonRpcNotification): string | undefined {
  if (notification.method !== 'session/update') {
    return undefined;
  }

  const params = notification.params as Record<string, unknown> | undefined;
  if (!params) {
    return undefined;
  }

  const finishReason = toOptionalString((params as any).finishReason) ?? toOptionalString((params as any).finish_reason);
  if (finishReason) {
    return finishReason;
  }

  const data = params.data as Record<string, unknown> | undefined;
  return toOptionalString((data as any)?.finishReason) ?? toOptionalString((data as any)?.finish_reason);
}

function ensureResultPayload(response: JsonRpcResponse, fallback: unknown): unknown {
  if (response && 'result' in response) {
    return response.result ?? fallback;
  }
  return fallback;
}

export class AcpStdioClient {
  private readonly config: AcpStdioConfig;
  private readonly rpc: StdioJsonRpcClient | null;
  private initialized = false;

  private pendingText: string | null = null;
  private pendingFinishReason: string | undefined;

  constructor(config: AcpStdioConfig) {
    this.config = config;
    if (!config.command.trim()) {
      this.rpc = null;
      return;
    }

    this.rpc = new StdioJsonRpcClient(config.command, config.args, config.env, config.cwd, {
      timeoutMs: config.timeoutMs,
      name: 'ACP',
    });

    this.rpc.on('notification', (message: unknown) => {
      const notification = message as JsonRpcNotification;
      if (!notification || notification.jsonrpc !== '2.0' || !notification.method) {
        return;
      }

      const text = extractTextFromNotification(notification);
      if (text) {
        this.pendingText = text;
      }

      const finishReason = extractFinishReasonFromNotification(notification);
      if (finishReason) {
        this.pendingFinishReason = finishReason;
      }
    });

    this.rpc.on('stderr', (chunk: unknown) => {
      const text = typeof chunk === 'string' ? chunk.trim() : '';
      if (text) {
        console.warn(`[ACP stdio] ${text}`);
      }
    });
  }

  isConfigured(): boolean {
    return Boolean(this.rpc);
  }

  getStatus(): AcpClientStatus {
    if (!this.isConfigured()) {
      return { configured: false, timeoutMs: this.config.timeoutMs, transport: 'stdio' };
    }

    return {
      configured: true,
      timeoutMs: this.config.timeoutMs,
      transport: 'stdio',
      command: this.config.command,
      env: this.config.env,
      cwd: this.config.cwd,
    };
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.rpc) {
      throw new Error('ACP stdio client is not configured. Set ACP_STDIO_COMMAND.');
    }

    const response = await this.rpc.request(
      'initialize',
      {
        client: {
          name: 'pulse-coder-engine/built-in-acp',
          version: '0.1.0',
        },
        capabilities: {
          session: ['new', 'prompt', 'cancel'],
        },
      },
      this.config.timeoutMs,
    );

    if (response.error) {
      throw new Error(response.error.message);
    }

    this.initialized = true;
  }

  async createSession(input: AcpNewSessionInput): Promise<AcpNewSessionResult> {
    await this.ensureInitialized();

    if (!this.rpc) {
      throw new Error('ACP stdio client is not configured.');
    }

    const response = await this.rpc.request(
      'session/new',
      {
        target: input.target,
        metadata: input.metadata ?? {},
      },
      this.config.timeoutMs,
    );

    if (response.error) {
      throw new Error(response.error.message);
    }

    const payload = ensureResultPayload(response, response);
    const sessionId = extractSessionId(payload);
    if (!sessionId) {
      throw new Error('ACP session/new response missing session id');
    }

    return { sessionId, raw: payload };
  }

  async prompt(input: AcpPromptInput): Promise<AcpPromptResult> {
    await this.ensureInitialized();

    if (!this.rpc) {
      throw new Error('ACP stdio client is not configured.');
    }

    this.pendingText = null;
    this.pendingFinishReason = undefined;

    const response = await this.rpc.request(
      'session/prompt',
      {
        sessionId: input.sessionId,
        session_id: input.sessionId,
        target: input.target,
        prompt: input.prompt,
        metadata: input.metadata ?? {},
      },
      this.config.timeoutMs,
    );

    if (response.error) {
      throw new Error(response.error.message);
    }

    const payload = ensureResultPayload(response, response);
    const text = extractText(payload) || this.pendingText || '';
    const finishReason = extractFinishReason(payload) ?? this.pendingFinishReason;

    return {
      text,
      finishReason,
      raw: payload,
    };
  }

  async cancel(input: AcpCancelInput): Promise<{ ok: boolean; raw: unknown }> {
    await this.ensureInitialized();

    if (!this.rpc) {
      throw new Error('ACP stdio client is not configured.');
    }

    const response = await this.rpc.request(
      'session/cancel',
      {
        sessionId: input.sessionId,
        session_id: input.sessionId,
        reason: input.reason,
      },
      this.config.timeoutMs,
    );

    if (response.error) {
      throw new Error(response.error.message);
    }

    const payload = ensureResultPayload(response, response);
    return { ok: true, raw: payload };
  }
}
