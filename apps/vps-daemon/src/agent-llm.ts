import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentToolSchema } from './agent-tools-schema.js';

export type AgentLlmProvider = 'openai' | 'anthropic';

export interface AgentLlmConfig {
  provider: AgentLlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AgentLlmOverride {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface LlmStreamResult {
  text: string;
  toolCalls: LlmToolCall[];
}

function defaultEnvFilePath(): string {
  return join(homedir(), '.pulse-vps-daemon', '.env');
}

function readDotEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && val) out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAgentLlmConfigToEnvFile(
  input: AgentLlmOverride,
  envFilePath = defaultEnvFilePath(),
): void {
  const existing = readDotEnvFile(envFilePath);
  const next = { ...existing };
  if (input.provider === 'openai' || input.provider === 'anthropic') {
    next.PULSE_AGENT_PROVIDER = input.provider;
  }
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    next.PULSE_AGENT_API_KEY = input.apiKey.trim();
  }
  if (typeof input.baseUrl === 'string') {
    if (input.baseUrl.trim()) next.PULSE_AGENT_BASE_URL = input.baseUrl.trim();
    else delete next.PULSE_AGENT_BASE_URL;
  }
  if (typeof input.model === 'string') {
    if (input.model.trim()) next.PULSE_AGENT_MODEL = input.model.trim();
    else delete next.PULSE_AGENT_MODEL;
  }
  mkdirSync(dirname(envFilePath), { recursive: true });
  const lines = Object.entries(next).map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, '')}`);
  writeFileSync(envFilePath, `${lines.join('\n')}\n`, { encoding: 'utf-8', mode: 0o600 });
}

export function resolveAgentLlmConfig(override?: AgentLlmOverride): AgentLlmConfig | null {
  const fileEnv = readDotEnvFile(defaultEnvFilePath());
  const get = (key: string): string => (process.env[key] ?? fileEnv[key] ?? '').trim();

  const ovProvider = typeof override?.provider === 'string' ? override.provider.trim().toLowerCase() : '';
  const ovKey = typeof override?.apiKey === 'string' ? override.apiKey.trim() : '';
  const ovBase = typeof override?.baseUrl === 'string' ? override.baseUrl.trim() : '';
  const ovModel = typeof override?.model === 'string' ? override.model.trim() : '';

  const explicitProvider = ovProvider || get('PULSE_AGENT_PROVIDER').toLowerCase();
  const pulseKey = ovKey || get('PULSE_AGENT_API_KEY');
  const anthropicKey = get('ANTHROPIC_API_KEY');
  const openaiKey = get('OPENAI_API_KEY');

  let provider: AgentLlmProvider;
  if (explicitProvider === 'anthropic' || explicitProvider === 'openai') {
    provider = explicitProvider;
  } else if (!pulseKey && anthropicKey && !openaiKey) {
    provider = 'anthropic';
  } else if (
    (ovBase || get('PULSE_AGENT_BASE_URL')).includes('anthropic') ||
    (ovModel || get('PULSE_AGENT_MODEL')).startsWith('claude')
  ) {
    provider = 'anthropic';
  } else {
    provider = 'openai';
  }

  const apiKey = pulseKey || (provider === 'anthropic' ? anthropicKey : openaiKey) || anthropicKey || openaiKey;
  if (!apiKey) return null;

  const defaultBase = provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
  const baseUrl = (
    ovBase ||
    get('PULSE_AGENT_BASE_URL') ||
    (provider === 'anthropic' ? get('ANTHROPIC_BASE_URL') : get('OPENAI_BASE_URL')) ||
    defaultBase
  ).replace(/\/+$/, '');

  const model =
    ovModel ||
    get('PULSE_AGENT_MODEL') ||
    (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4.1');

  return { provider, apiKey, baseUrl, model };
}

function safeJsonParseObject(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function consumeSseLines(
  body: ReadableStream<Uint8Array>,
  onData: (eventName: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const rawLine of block.split(/\r?\n/)) {
          if (rawLine.startsWith('event:')) {
            eventName = rawLine.slice(6).trim();
          } else if (rawLine.startsWith('data:')) {
            dataLines.push(rawLine.slice(5).trim());
          }
        }
        if (dataLines.length > 0) {
          onData(eventName, dataLines.join('\n'));
        }
        sep = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function streamOpenAi(
  config: AgentLlmConfig,
  messages: LlmMessage[],
  tools: readonly AgentToolSchema[],
  signal: AbortSignal,
  onTextDelta: (delta: string) => void,
): Promise<LlmStreamResult> {
  const apiMessages = messages.map((msg) => {
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: msg.content,
      };
    }
    return { role: msg.role, content: msg.content };
  });

  const url = config.baseUrl.endsWith('/chat/completions')
    ? config.baseUrl
    : `${config.baseUrl}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages: apiMessages,
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  let text = '';
  const pendingTools = new Map<number, { id: string; name: string; argsRaw: string }>();

  await consumeSseLines(res.body, (_event, data) => {
    if (data === '[DONE]') return;
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(data) as Record<string, any>;
    } catch {
      return;
    }
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      onTextDelta(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === 'number' ? tc.index : 0;
        const entry = pendingTools.get(idx) ?? { id: '', name: '', argsRaw: '' };
        if (typeof tc.id === 'string' && tc.id) entry.id = tc.id;
        if (typeof tc.function?.name === 'string' && tc.function.name) entry.name += tc.function.name;
        if (typeof tc.function?.arguments === 'string') entry.argsRaw += tc.function.arguments;
        pendingTools.set(idx, entry);
      }
    }
  });

  const toolCalls: LlmToolCall[] = Array.from(pendingTools.entries())
    .sort((a, b) => a[0] - b[0])
    .filter(([, entry]) => Boolean(entry.name))
    .map(([idx, entry]) => ({
      id: entry.id || `call_${idx}_${Date.now()}`,
      name: entry.name,
      args: safeJsonParseObject(entry.argsRaw),
    }));

  return { text, toolCalls };
}

async function streamAnthropic(
  config: AgentLlmConfig,
  messages: LlmMessage[],
  tools: readonly AgentToolSchema[],
  signal: AbortSignal,
  onTextDelta: (delta: string) => void,
): Promise<LlmStreamResult> {
  const systemText = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'user') {
      anthropicMessages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      const blocks: unknown[] = [];
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      for (const tc of msg.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
      }
      anthropicMessages.push({ role: 'assistant', content: blocks.length > 0 ? blocks : msg.content });
    } else if (msg.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: msg.toolCallId, content: msg.content };
      const prev = anthropicMessages[anthropicMessages.length - 1];
      if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
        (prev.content as unknown[]).push(block);
      } else {
        anthropicMessages.push({ role: 'user', content: [block] });
      }
    }
  }

  const url = config.baseUrl.endsWith('/v1/messages')
    ? config.baseUrl
    : `${config.baseUrl}/v1/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 8192,
      stream: true,
      ...(systemText ? { system: systemText } : {}),
      messages: anthropicMessages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  let text = '';
  const pendingTools = new Map<number, { id: string; name: string; argsRaw: string }>();

  await consumeSseLines(res.body, (_event, data) => {
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(data) as Record<string, any>;
    } catch {
      return;
    }
    if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
      const idx = typeof parsed.index === 'number' ? parsed.index : 0;
      pendingTools.set(idx, {
        id: String(parsed.content_block.id || `tool_${idx}`),
        name: String(parsed.content_block.name || ''),
        argsRaw: '',
      });
    } else if (parsed.type === 'content_block_delta') {
      if (parsed.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string') {
        text += parsed.delta.text;
        onTextDelta(parsed.delta.text);
      } else if (parsed.delta?.type === 'input_json_delta' && typeof parsed.delta.partial_json === 'string') {
        const idx = typeof parsed.index === 'number' ? parsed.index : 0;
        const entry = pendingTools.get(idx);
        if (entry) entry.argsRaw += parsed.delta.partial_json;
      }
    }
  });

  const toolCalls: LlmToolCall[] = Array.from(pendingTools.entries())
    .sort((a, b) => a[0] - b[0])
    .filter(([, entry]) => Boolean(entry.name))
    .map(([idx, entry]) => ({
      id: entry.id || `call_${idx}_${Date.now()}`,
      name: entry.name,
      args: safeJsonParseObject(entry.argsRaw),
    }));

  return { text, toolCalls };
}

export async function streamLlmTurn(
  config: AgentLlmConfig,
  messages: LlmMessage[],
  tools: readonly AgentToolSchema[],
  signal: AbortSignal,
  onTextDelta: (delta: string) => void,
): Promise<LlmStreamResult> {
  if (config.provider === 'anthropic') {
    return await streamAnthropic(config, messages, tools, signal, onTextDelta);
  }
  return await streamOpenAi(config, messages, tools, signal, onTextDelta);
}
