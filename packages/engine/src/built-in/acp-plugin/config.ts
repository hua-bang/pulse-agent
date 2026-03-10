import path from 'path';
import { homedir } from 'os';

import type { AcpClientConfig } from './types';

export const ACP_SERVICE_NAME = 'acpBridgeService';
export const DEFAULT_TARGET = 'codex';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_SESSION_STORE_PATH = path.join(homedir(), '.pulse-coder', 'acp', 'sessions.json');

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
