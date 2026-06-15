/**
 * OAuth 2.1 support for the built-in MCP plugin.
 *
 * `@ai-sdk/mcp` ships an `OAuthClientProvider` contract plus an `auth()` helper
 * that together implement the MCP authorization spec (metadata discovery,
 * dynamic client registration, PKCE, and token refresh). This module wraps
 * that contract with:
 *
 *   - `createFileOAuthProvider` — a provider whose tokens / client
 *     registration / PKCE verifier persist to a JSON file (optionally
 *     encrypted via an injected cipher), and whose browser redirect is
 *     delegated to the host.
 *   - `authorizeMcpServer` — drives an interactive sign-in: discovery +
 *     registration + redirect, then exchanges the returned code for tokens.
 *
 * The engine stays host-agnostic. Opening a browser and capturing the OAuth
 * redirect are the host's job (e.g. Electron opens the system browser and runs
 * a loopback callback server); the engine owns only persistence and the spec
 * flow. Background connections pass a no-op `redirectToAuthorization` so a
 * missing token surfaces as `UnauthorizedError` instead of spawning browser
 * tabs on every engine reload.
 */

import { promises as fs } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import {
  auth,
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthTokens,
} from '@ai-sdk/mcp';

export { UnauthorizedError };
export type { OAuthClientProvider, OAuthClientInformation, OAuthTokens };

/** Symmetric cipher so tokens aren't persisted in plaintext at rest. */
export interface OAuthCipher {
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}

/** Everything persisted for one server's OAuth session. */
interface OAuthRecord {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformation;
  codeVerifier?: string;
  state?: string;
}

/** On-disk envelope; `data` is JSON (enc=false) or a cipher blob (enc=true). */
interface StoredFile {
  v: 1;
  enc: boolean;
  data: string;
}

export interface FileOAuthProviderOptions {
  /** Absolute path to the JSON file backing this server's OAuth session. */
  filePath: string;
  /** Redirect URI registered with the authorization server. */
  redirectUrl: string;
  /** Client name advertised during dynamic client registration. */
  clientName?: string;
  /** Requested scopes (space-joined into client metadata + auth request). */
  scopes?: string[];
  /**
   * Fixed CSRF `state` value for an interactive flow. When set, `state()`
   * always returns it so the host can verify the value echoed back on the
   * redirect. Omit for background providers (no interactive redirect).
   */
  state?: string;
  /**
   * Opens the authorization URL so the user can approve. The engine never
   * opens a browser itself — the host wires this (a no-op for background
   * connects, a real browser-open for interactive sign-in).
   */
  redirectToAuthorization: (url: URL) => void | Promise<void>;
  /** Optional at-rest encryption. When omitted, the file is plaintext JSON. */
  cipher?: OAuthCipher;
}

async function readRecord(filePath: string, cipher?: OAuthCipher): Promise<OAuthRecord> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return {};
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as StoredFile;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.data !== 'string') return {};
    if (parsed.enc) {
      // Encrypted on disk but no key available now (e.g. OS keychain locked):
      // treat as absent so the user is asked to re-authorize rather than crash.
      if (!cipher) return {};
      return JSON.parse(cipher.decrypt(parsed.data)) as OAuthRecord;
    }
    return JSON.parse(parsed.data) as OAuthRecord;
  } catch {
    return {};
  }
}

async function writeRecord(filePath: string, record: OAuthRecord, cipher?: OAuthCipher): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const json = JSON.stringify(record);
  const file: StoredFile = cipher
    ? { v: 1, enc: true, data: cipher.encrypt(json) }
    : { v: 1, enc: false, data: json };
  // mode 0600 — tokens are secrets; keep them owner-readable only.
  await fs.writeFile(filePath, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/**
 * An `OAuthClientProvider` backed by a single JSON file. Reads/writes are
 * serialized so the rapid save sequence `auth()` performs (verifier → client
 * info → tokens) never interleaves into a corrupt file.
 */
export function createFileOAuthProvider(opts: FileOAuthProviderOptions): OAuthClientProvider {
  const { filePath, redirectUrl, cipher } = opts;

  // Serialize read-modify-write; reads wait on the latest write to avoid
  // observing a half-applied record.
  let chain: Promise<void> = Promise.resolve();
  const update = (mut: (r: OAuthRecord) => void): Promise<void> => {
    const next = chain.then(async () => {
      const record = await readRecord(filePath, cipher);
      mut(record);
      await writeRecord(filePath, record, cipher);
    });
    chain = next.catch(() => {});
    return next;
  };
  const read = async (): Promise<OAuthRecord> => {
    await chain;
    return readRecord(filePath, cipher);
  };

  return {
    get redirectUrl() {
      return redirectUrl;
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: opts.clientName ?? 'Pulse Coder',
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        // Public native client — credentials are protected by PKCE, not a secret.
        token_endpoint_auth_method: 'none',
        ...(opts.scopes && opts.scopes.length > 0 ? { scope: opts.scopes.join(' ') } : {}),
      };
    },
    async tokens() {
      return (await read()).tokens;
    },
    async saveTokens(tokens) {
      await update((r) => {
        r.tokens = tokens;
      });
    },
    async clientInformation() {
      return (await read()).clientInformation;
    },
    async saveClientInformation(info) {
      await update((r) => {
        r.clientInformation = info;
      });
    },
    async codeVerifier() {
      const verifier = (await read()).codeVerifier;
      if (!verifier) {
        throw new Error('No PKCE code verifier stored; restart the authorization flow');
      }
      return verifier;
    },
    async saveCodeVerifier(verifier) {
      await update((r) => {
        r.codeVerifier = verifier;
      });
    },
    async state() {
      const value = opts.state ?? randomUUID();
      await update((r) => {
        r.state = value;
      });
      return value;
    },
    redirectToAuthorization: opts.redirectToAuthorization,
    async invalidateCredentials(scope) {
      await update((r) => {
        if (scope === 'all') {
          delete r.tokens;
          delete r.clientInformation;
          delete r.codeVerifier;
          delete r.state;
        } else if (scope === 'tokens') {
          delete r.tokens;
        } else if (scope === 'client') {
          delete r.clientInformation;
        } else if (scope === 'verifier') {
          delete r.codeVerifier;
        }
      });
    },
  };
}

export interface AuthorizeOptions {
  /** Base URL of the MCP server being authorized. */
  serverUrl: string | URL;
  /** Space-joined scopes to request (mirrors the provider's client metadata). */
  scope?: string;
  /** CSRF state we expect echoed back on the redirect; mismatch aborts. */
  expectedState?: string;
  /**
   * Resolves once the host has captured the OAuth redirect, yielding the
   * `code` (and any `state`) from the callback query string.
   */
  waitForCallback: () => Promise<{ code: string; state?: string }>;
}

/**
 * Run the interactive authorization-code flow for an MCP server.
 *
 * Leg 1 (`auth` with no code) performs discovery + dynamic registration +
 * PKCE, then invokes `provider.redirectToAuthorization(url)` and returns
 * `'REDIRECT'` (or short-circuits to `'AUTHORIZED'` if a valid token already
 * exists). The host then captures the redirect; leg 2 exchanges the code for
 * tokens, which the provider persists.
 */
export async function authorizeMcpServer(
  provider: OAuthClientProvider,
  opts: AuthorizeOptions,
): Promise<void> {
  const first = await auth(provider, { serverUrl: opts.serverUrl, scope: opts.scope });
  if (first === 'AUTHORIZED') return;

  const { code, state } = await opts.waitForCallback();
  if (opts.expectedState !== undefined && state !== undefined && state !== opts.expectedState) {
    throw new Error('OAuth state mismatch (possible CSRF); aborting sign-in');
  }

  const second = await auth(provider, {
    serverUrl: opts.serverUrl,
    authorizationCode: code,
    scope: opts.scope,
  });
  if (second !== 'AUTHORIZED') {
    throw new Error('OAuth authorization did not complete');
  }
}
