/**
 * Canvas-side wiring for MCP OAuth 2.1.
 *
 * The engine owns the spec flow + token persistence (`createFileOAuthProvider`
 * / `authorizeMcpServer`); this module supplies the host-specific pieces:
 *
 *   - `getMcpOAuthCipher` — OS-backed at-rest encryption via Electron
 *     `safeStorage` (falls back to plaintext when unavailable, e.g. Linux
 *     without a keyring).
 *   - `createConnectAuthProvider` — the provider handed to the engine during
 *     normal connects. Its `redirectToAuthorization` is a no-op so a missing
 *     token surfaces as a `needsAuth` status instead of popping a browser on
 *     every engine reload.
 *   - `runMcpOAuthSignIn` — the interactive flow: open the system browser to
 *     the authorization URL and capture the redirect on a loopback server
 *     (RFC 8252), then exchange the code for tokens.
 *   - `clearMcpOAuth` — forget stored credentials (sign out).
 */

import { createServer, type Server } from 'http';
import { randomUUID } from 'crypto';
import { shell, safeStorage } from 'electron';
import {
  authorizeMcpServer,
  createFileOAuthProvider,
  type OAuthCipher,
  type OAuthClientProvider,
} from 'pulse-coder-engine/built-in';
import { mcpOAuthTokenFile } from '../config-scope';

export const MCP_OAUTH_CLIENT_NAME = 'Pulse Canvas';

// Preferred loopback ports for the OAuth redirect. A fixed set keeps the
// registered redirect_uri stable across sessions (dynamic client registration
// records an exact URI); we fall back through the list if one is busy.
const OAUTH_CALLBACK_PORTS = [33418, 33419, 33420, 33421];

/** Stable redirect used by background providers (never actually navigated). */
const DEFAULT_REDIRECT_URI = `http://127.0.0.1:${OAUTH_CALLBACK_PORTS[0]}/callback`;

/** How long to wait for the user to finish authorizing in their browser. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

let cachedCipher: OAuthCipher | null | undefined;

/**
 * An at-rest cipher backed by the OS keychain, or `undefined` when encryption
 * isn't available (tokens then persist as plaintext JSON). Resolved once and
 * cached.
 */
export function getMcpOAuthCipher(): OAuthCipher | undefined {
  if (cachedCipher !== undefined) return cachedCipher ?? undefined;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      cachedCipher = {
        encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
        decrypt: (blob) => safeStorage.decryptString(Buffer.from(blob, 'base64')),
      };
    } else {
      cachedCipher = null;
    }
  } catch {
    cachedCipher = null;
  }
  return cachedCipher ?? undefined;
}

/**
 * Provider used during normal engine connects. Reuses any stored token and
 * silently refreshes via refresh_token, but never opens a browser — a missing
 * or unrecoverable token rejects the connect with `UnauthorizedError`, which
 * the plugin reports as `needsAuth` for the UI to act on.
 */
export function createConnectAuthProvider(
  serverName: string,
  server: { scopes?: string[] },
): OAuthClientProvider {
  return createFileOAuthProvider({
    filePath: mcpOAuthTokenFile(serverName),
    redirectUrl: DEFAULT_REDIRECT_URI,
    clientName: MCP_OAUTH_CLIENT_NAME,
    scopes: server.scopes,
    cipher: getMcpOAuthCipher(),
    redirectToAuthorization: () => {
      /* background connect — never navigate; surface needsAuth instead */
    },
  });
}

interface LoopbackCallback {
  code: string;
  state?: string;
}

interface LoopbackServer {
  redirectUri: string;
  waitForCallback: () => Promise<LoopbackCallback>;
  close: () => void;
}

const CALLBACK_HTML =
  '<!doctype html><meta charset="utf-8"><title>Pulse Canvas</title>' +
  '<body style="font-family:system-ui,-apple-system,sans-serif;padding:3rem;color:#1e293b">' +
  '<h2 style="margin:0 0 .5rem">✓ 授权完成</h2>' +
  '<p style="color:#64748b">你可以关闭此页面，返回 Pulse Canvas。</p></body>';

/** Bind a loopback HTTP server on the first free preferred port. */
async function startLoopbackServer(): Promise<LoopbackServer> {
  let lastErr: unknown;
  for (const port of OAUTH_CALLBACK_PORTS) {
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
    } catch (err: any) {
      lastErr = err;
      if (err?.code === 'EADDRINUSE') continue;
      throw err;
    }

    let resolveCb!: (value: LoopbackCallback) => void;
    let rejectCb!: (err: Error) => void;
    const callback = new Promise<LoopbackCallback>((resolve, reject) => {
      resolveCb = resolve;
      rejectCb = reject;
    });
    const timer = setTimeout(() => rejectCb(new Error('OAuth sign-in timed out')), SIGN_IN_TIMEOUT_MS);
    timer.unref?.();

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(CALLBACK_HTML);

      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state') ?? undefined;
      clearTimeout(timer);
      if (error) {
        rejectCb(new Error(`Authorization denied: ${url.searchParams.get('error_description') ?? error}`));
      } else if (!code) {
        rejectCb(new Error('No authorization code in OAuth callback'));
      } else {
        resolveCb({ code, state });
      }
    });

    return {
      redirectUri: `http://127.0.0.1:${port}/callback`,
      waitForCallback: () => callback,
      close: () => {
        clearTimeout(timer);
        server.close();
      },
    };
  }
  throw new Error(
    `No free loopback port for the OAuth callback (tried ${OAUTH_CALLBACK_PORTS.join(', ')}): ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/**
 * Run the interactive OAuth sign-in for one server: bind a loopback callback
 * server, drive the engine's two-leg authorization flow, and open the system
 * browser when the engine asks to redirect. Tokens are persisted by the
 * provider on success.
 */
export async function runMcpOAuthSignIn(
  serverName: string,
  serverUrl: string,
  scopes?: string[],
): Promise<{ ok: boolean; error?: string }> {
  let loopback: LoopbackServer | undefined;
  try {
    loopback = await startLoopbackServer();
    const state = randomUUID();
    const provider = createFileOAuthProvider({
      filePath: mcpOAuthTokenFile(serverName),
      redirectUrl: loopback.redirectUri,
      clientName: MCP_OAUTH_CLIENT_NAME,
      scopes,
      state,
      cipher: getMcpOAuthCipher(),
      redirectToAuthorization: async (url) => {
        await shell.openExternal(url.toString());
      },
    });

    await authorizeMcpServer(provider, {
      serverUrl,
      scope: scopes && scopes.length > 0 ? scopes.join(' ') : undefined,
      expectedState: state,
      waitForCallback: () => loopback!.waitForCallback(),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    loopback?.close();
  }
}

/** Forget stored OAuth credentials for a server (sign out). */
export async function clearMcpOAuth(serverName: string): Promise<void> {
  const provider = createFileOAuthProvider({
    filePath: mcpOAuthTokenFile(serverName),
    redirectUrl: DEFAULT_REDIRECT_URI,
    cipher: getMcpOAuthCipher(),
    redirectToAuthorization: () => {},
  });
  await provider.invalidateCredentials?.('all');
}
