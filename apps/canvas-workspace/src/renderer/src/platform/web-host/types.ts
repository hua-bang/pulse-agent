import type { RemoteVpsShareRole } from '../../../../shared/api/remote-vps';

export interface WebHostAuthSession {
  /** Normalized base URL without trailing slash (e.g. `https://vps.ts.net` or `http://127.0.0.1:4770`). */
  endpoint: string;
  /** Raw VPS admin token or scoped share token. */
  token: string;
  /** Role returned by `/v1/meta` (`admin`, `collaborator`, `editor`, `viewer`). */
  role: 'admin' | RemoteVpsShareRole;
  /** Present when authenticated with a scoped share token. */
  workspaceId?: string;
  workspaceName?: string;
  shareLabel?: string;
  version?: string;
  senderName: string;
  clientId: string;
}

export interface WebHostStoredCredentials {
  endpoint: string;
  token: string;
  senderName?: string;
  workspaceName?: string;
}

export const WEB_HOST_STORAGE_KEY = 'pulse.webHost.auth.v1';
export const WEB_HOST_CLIENT_ID_KEY = 'pulse.webHost.clientId.v1';
export const WEB_HOST_ACTIVE_WS_KEY = 'pulse.webHost.activeWorkspace.v1';

export function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:4770';
  }
  return trimmed;
}

export function getOrCreateWebClientId(): string {
  try {
    const existing = window.localStorage.getItem(WEB_HOST_CLIENT_ID_KEY)?.trim();
    if (existing) return existing;
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `web-${crypto.randomUUID().slice(0, 12)}`
        : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    window.localStorage.setItem(WEB_HOST_CLIENT_ID_KEY, created);
    return created;
  } catch {
    return `web-${Date.now().toString(36)}`;
  }
}
