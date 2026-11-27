import type { RemoteVpsShareRole } from '../../../../shared/api/remote-vps';
import {
  WEB_HOST_STORAGE_KEY,
  getOrCreateWebClientId,
  normalizeEndpoint,
  type WebHostAuthSession,
  type WebHostStoredCredentials,
} from './types';

interface VpsMetaResponse {
  ok: boolean;
  version?: string;
  role?: string;
  workspaceId?: string;
  shareLabel?: string;
}

function parseRole(raw: unknown): 'admin' | RemoteVpsShareRole {
  if (raw === 'viewer' || raw === 'editor' || raw === 'collaborator') return raw;
  return 'admin';
}

function decodeBase64UrlJson(encoded: string): Record<string, unknown> | null {
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const binary = atob(normalized + pad);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseInviteInput(raw: string): { endpoint?: string; token: string } {
  const trimmed = raw.trim();
  // Match Pulse Canvas native share invite code (supports pasting an entire chat message).
  const shareMatch = /pulse-share:\/\/v1\/([A-Za-z0-9_-]+)/.exec(trimmed);
  if (shareMatch) {
    const payload = decodeBase64UrlJson(shareMatch[1]);
    const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
    const endpoint = typeof payload?.endpoint === 'string' ? payload.endpoint.trim() : '';
    if (token) {
      return { token, ...(endpoint ? { endpoint } : {}) };
    }
  }
  if (trimmed.startsWith('pulse://') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const invite = parsed.searchParams.get('invite')?.trim();
      if (invite) {
        const payload = decodeBase64UrlJson(invite);
        const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
        const endpoint = typeof payload?.endpoint === 'string' ? payload.endpoint.trim() : '';
        if (token) {
          return { token, ...(endpoint ? { endpoint } : {}) };
        }
      }
      const token = parsed.searchParams.get('token')?.trim();
      const endpoint = parsed.searchParams.get('endpoint')?.trim();
      if (token) {
        return { token, ...(endpoint ? { endpoint } : {}) };
      }
    } catch {
      // Fall back to treating raw input as a token.
    }
  }
  return { token: trimmed };
}

function readCredentialsFromUrl(): WebHostStoredCredentials | null {
  try {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const inviteParam = (url.searchParams.get('invite') ?? hashParams.get('invite') ?? '').trim();
    const senderName = (url.searchParams.get('name') ?? hashParams.get('name') ?? '').trim();

    let token = (url.searchParams.get('token') ?? hashParams.get('token') ?? '').trim();
    let endpoint = (url.searchParams.get('endpoint') ?? hashParams.get('endpoint') ?? '').trim();

    if (inviteParam) {
      const decoded = inviteParam.includes('pulse-share://v1/')
        ? parseInviteInput(inviteParam)
        : (() => {
            const payload = decodeBase64UrlJson(inviteParam);
            const t = typeof payload?.token === 'string' ? payload.token.trim() : '';
            const ep = typeof payload?.endpoint === 'string' ? payload.endpoint.trim() : '';
            return t ? { token: t, ...(ep ? { endpoint: ep } : {}) } : null;
          })();
      if (decoded?.token) {
        token = decoded.token;
        if (decoded.endpoint) endpoint = decoded.endpoint;
      }
    }

    if (!token) return null;

    // Strip credentials from the address bar immediately so they do not linger in history/screenshots.
    for (const key of ['token', 'endpoint', 'invite', 'name']) {
      url.searchParams.delete(key);
      hashParams.delete(key);
    }
    const nextHash = hashParams.toString();
    url.hash = nextHash ? `#${nextHash}` : '';
    window.history.replaceState(null, '', url.toString());
    return { endpoint, token, ...(senderName ? { senderName } : {}) };
  } catch {
    return null;
  }
}

function readStoredCredentials(): WebHostStoredCredentials | null {
  try {
    const raw = window.localStorage.getItem(WEB_HOST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WebHostStoredCredentials>;
    if (typeof parsed.token !== 'string' || !parsed.token.trim()) return null;
    return {
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
      token: parsed.token.trim(),
      ...(typeof parsed.senderName === 'string' && parsed.senderName.trim()
        ? { senderName: parsed.senderName.trim() }
        : {}),
    };
  } catch {
    return null;
  }
}

function saveWebHostCredentials(creds: WebHostStoredCredentials): void {
  try {
    window.localStorage.setItem(WEB_HOST_STORAGE_KEY, JSON.stringify(creds));
  } catch {
    // Ignore storage quota / private mode errors.
  }
}

async function verifyWebHostCredentials(
  creds: WebHostStoredCredentials,
): Promise<{ ok: true; session: WebHostAuthSession } | { ok: false; error: string }> {
  const endpoint = normalizeEndpoint(creds.endpoint);
  const token = creds.token.trim();
  if (!token) {
    return { ok: false, error: 'Please enter a VPS token or share link.' };
  }
  try {
    const res = await fetch(`${endpoint}/v1/meta`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid or expired token (401).' };
    }
    if (!res.ok) {
      return { ok: false, error: `VPS daemon returned HTTP ${res.status}.` };
    }
    const meta = (await res.json()) as VpsMetaResponse;
    if (!meta.ok) {
      return { ok: false, error: 'Unexpected response from VPS daemon.' };
    }
    const role = parseRole(meta.role);
    const senderName =
      creds.senderName?.trim() || meta.shareLabel?.trim() || (role === 'admin' ? 'Owner' : 'Web Guest');
    return {
      ok: true,
      session: {
        endpoint,
        token,
        role,
        ...(meta.workspaceId ? { workspaceId: meta.workspaceId } : {}),
        ...(meta.shareLabel ? { shareLabel: meta.shareLabel } : {}),
        ...(meta.version ? { version: meta.version } : {}),
        senderName,
        clientId: getOrCreateWebClientId(),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to reach VPS daemon.',
    };
  }
}

function mountAuthGate(
  root: HTMLElement,
  initial: Partial<WebHostStoredCredentials>,
  initialError?: string,
): Promise<WebHostAuthSession> {
  return new Promise((resolveSession) => {
    const isZh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
    const copy = isZh
      ? {
          eyebrow: 'PULSE CANVAS · WEB',
          title: '连接到远程工作区',
          subtitle: '支持直接粘贴桌面端「Share」生成的 pulse-share://v1/... 邀请码，或 VPS 管理员 Token。',
          tokenLabel: '共享邀请码 / VPS Token',
          tokenPlaceholder: '粘贴 pulse-share://v1/... 或 PULSE_VPS_TOKEN',
          nameLabel: '协作昵称（可选）',
          namePlaceholder: '例如：Jasper（手机）',
          advanced: '自定义 VPS 地址（使用邀请码时无需填写）',
          endpointLabel: 'VPS 地址（留空默认当前域名）',
          submit: '进入工作区',
          connecting: '连接中...',
        }
      : {
          eyebrow: 'PULSE CANVAS · WEB',
          title: 'Connect to Workspace',
          subtitle: 'Paste a pulse-share://v1/... invite code from desktop Share, or your VPS admin token.',
          tokenLabel: 'Invite Code or VPS Token',
          tokenPlaceholder: 'Paste pulse-share://v1/... or PULSE_VPS_TOKEN',
          nameLabel: 'Display Name (optional)',
          namePlaceholder: 'e.g. Jasper (Mobile)',
          advanced: 'Custom VPS Endpoint (optional for invite codes)',
          endpointLabel: 'VPS Endpoint URL (blank = current origin)',
          submit: 'Open Workspace',
          connecting: 'Connecting...',
        };

    const defaultEndpoint = initial.endpoint?.trim() || '';
    root.innerHTML = `
      <div class="pulse-web-auth-backdrop">
        <form class="pulse-web-auth-card" id="pulse-web-auth-form">
          <div class="pulse-web-auth-header">
            <img class="pulse-web-auth-logo" src="/icon.png" alt="Pulse Canvas" />
            <div class="pulse-web-auth-heading">
              <span class="pulse-web-auth-eyebrow">${copy.eyebrow}</span>
              <h1 class="pulse-web-auth-title">${copy.title}</h1>
            </div>
          </div>
          <div class="pulse-web-auth-body">
            <p class="pulse-web-auth-subtitle">${copy.subtitle}</p>
            <label class="pulse-web-auth-row">
              <span>${copy.tokenLabel}</span>
              <input id="pulse-web-token" type="password" autocomplete="off" required placeholder="${copy.tokenPlaceholder}" value="" />
            </label>
            <label class="pulse-web-auth-row">
              <span>${copy.nameLabel}</span>
              <input id="pulse-web-name" type="text" autocomplete="name" placeholder="${copy.namePlaceholder}" value="" />
            </label>
            <details class="pulse-web-auth-advanced" ${defaultEndpoint ? 'open' : ''}>
              <summary>${copy.advanced}</summary>
              <label class="pulse-web-auth-row">
                <span>${copy.endpointLabel}</span>
                <input id="pulse-web-endpoint" type="url" placeholder="${window.location.origin}" value="" />
              </label>
            </details>
            <div id="pulse-web-auth-error" class="pulse-web-auth-error" role="alert"></div>
            <button id="pulse-web-auth-submit" type="submit" class="pulse-web-auth-submit">${copy.submit}</button>
          </div>
        </form>
      </div>
    `;

    const form = document.getElementById('pulse-web-auth-form') as HTMLFormElement;
    const tokenInput = document.getElementById('pulse-web-token') as HTMLInputElement;
    const nameInput = document.getElementById('pulse-web-name') as HTMLInputElement;
    const endpointInput = document.getElementById('pulse-web-endpoint') as HTMLInputElement;
    const errorEl = document.getElementById('pulse-web-auth-error') as HTMLDivElement;
    const submitBtn = document.getElementById('pulse-web-auth-submit') as HTMLButtonElement;

    if (initial.token) tokenInput.value = initial.token;
    if (initial.senderName) nameInput.value = initial.senderName;
    if (defaultEndpoint) endpointInput.value = defaultEndpoint;
    if (initialError) errorEl.textContent = initialError;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = copy.connecting;
      try {
        const parsed = parseInviteInput(tokenInput.value);
        const creds: WebHostStoredCredentials = {
          endpoint: parsed.endpoint ?? endpointInput.value.trim(),
          token: parsed.token,
          ...(nameInput.value.trim() ? { senderName: nameInput.value.trim() } : {}),
        };
        const result = await verifyWebHostCredentials(creds);
        if (!result.ok) {
          errorEl.textContent = result.error;
          return;
        }
        saveWebHostCredentials(creds);
        root.innerHTML = '';
        resolveSession(result.session);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = copy.submit;
      }
    });
  });
}

export async function resolveWebHostSession(root: HTMLElement): Promise<WebHostAuthSession> {
  const fromUrl = readCredentialsFromUrl();
  const candidate = fromUrl ?? readStoredCredentials();
  if (candidate) {
    const verified = await verifyWebHostCredentials(candidate);
    if (verified.ok) {
      if (fromUrl) saveWebHostCredentials(candidate);
      return verified.session;
    }
    return mountAuthGate(root, candidate, verified.error);
  }
  return mountAuthGate(root, {});
}
