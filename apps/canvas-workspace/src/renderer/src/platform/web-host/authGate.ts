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

function parseInviteInput(raw: string): { endpoint?: string; token: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith('pulse://') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
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
    const token = (url.searchParams.get('token') ?? hashParams.get('token') ?? '').trim();
    if (!token) return null;
    const endpoint = (url.searchParams.get('endpoint') ?? hashParams.get('endpoint') ?? '').trim();
    const senderName = (url.searchParams.get('name') ?? hashParams.get('name') ?? '').trim();

    // Strip credentials from the address bar immediately so they do not linger in history/screenshots.
    url.searchParams.delete('token');
    url.searchParams.delete('endpoint');
    url.searchParams.delete('name');
    if (hashParams.has('token') || hashParams.has('endpoint') || hashParams.has('name')) {
      hashParams.delete('token');
      hashParams.delete('endpoint');
      hashParams.delete('name');
      const nextHash = hashParams.toString();
      url.hash = nextHash ? `#${nextHash}` : '';
    }
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
    const defaultEndpoint = initial.endpoint?.trim() || '';
    root.innerHTML = `
      <div class="pulse-web-auth-backdrop">
        <form class="pulse-web-auth-card" id="pulse-web-auth-form">
          <div class="pulse-web-auth-header">
            <div class="pulse-web-auth-logo">P</div>
            <div>
              <h1 class="pulse-web-auth-title">Pulse Canvas Web</h1>
              <p class="pulse-web-auth-subtitle">Connect to your VPS daemon to browse workspaces and join the shared chat room.</p>
            </div>
          </div>
          <label class="pulse-web-auth-field">
            <span>VPS Token or Share Link</span>
            <input id="pulse-web-token" type="password" autocomplete="off" required placeholder="Paste PULSE_VPS_TOKEN or share invite link..." value="" />
          </label>
          <label class="pulse-web-auth-field">
            <span>Display Name (optional)</span>
            <input id="pulse-web-name" type="text" autocomplete="name" placeholder="e.g. Jasper (Mobile)" value="" />
          </label>
          <details class="pulse-web-auth-advanced" ${defaultEndpoint ? 'open' : ''}>
            <summary>Advanced: Custom VPS Endpoint</summary>
            <label class="pulse-web-auth-field">
              <span>Endpoint URL (blank = current origin)</span>
              <input id="pulse-web-endpoint" type="url" placeholder="${window.location.origin}" value="" />
            </label>
          </details>
          <div id="pulse-web-auth-error" class="pulse-web-auth-error" role="alert"></div>
          <button id="pulse-web-auth-submit" type="submit" class="pulse-web-auth-submit">Connect to Workspace</button>
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
      submitBtn.textContent = 'Connecting...';
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
        submitBtn.textContent = 'Connect to Workspace';
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
