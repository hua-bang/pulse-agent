import { app, shell } from 'electron';
import { createServer, type Server } from 'http';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from 'pulse-coder-engine/built-in';
import { mcpAuth } from 'pulse-coder-engine/built-in';

const STORE_FILE_NAME = 'mcp-oauth.json';
const CALLBACK_PATH = '/oauth/callback';
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

interface StoredOAuthRecord {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformation;
  codeVerifier?: string;
  state?: string;
  updatedAt?: string;
}

interface StoredOAuthFile {
  servers?: Record<string, StoredOAuthRecord>;
}

interface OAuthOptions {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

type OAuthOptionInput = OAuthOptions | Record<string, unknown> | undefined;

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE_NAME);
}

function serverKey(serverName: string): string {
  return serverName.trim();
}

async function readStore(): Promise<StoredOAuthFile> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as StoredOAuthFile;
    return parsed && typeof parsed === 'object' ? parsed : { servers: {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { servers: {} };
    throw err;
  }
}

async function writeStore(store: StoredOAuthFile): Promise<void> {
  const path = storePath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify({ servers: store.servers ?? {} }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function updateRecord(
  serverName: string,
  updater: (record: StoredOAuthRecord) => StoredOAuthRecord,
): Promise<void> {
  const store = await readStore();
  const servers = { ...(store.servers ?? {}) };
  const key = serverKey(serverName);
  servers[key] = {
    ...updater({ ...(servers[key] ?? {}) }),
    updatedAt: new Date().toISOString(),
  };
  await writeStore({ servers });
}

async function readRecord(serverName: string): Promise<StoredOAuthRecord> {
  const store = await readStore();
  return store.servers?.[serverKey(serverName)] ?? {};
}

function sendHtml(res: import('http').ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

async function waitForAuthorizationCode(expectedState: string): Promise<{
  redirectUrl: string;
  code: Promise<string>;
  close: () => Promise<void>;
}> {
  let server: Server | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const code = new Promise<string>((resolve, reject) => {
    server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== CALLBACK_PATH) {
          sendHtml(res, 404, 'Not found');
          return;
        }
        const error = url.searchParams.get('error');
        if (error) {
          sendHtml(res, 400, `<h1>Authorization failed</h1><p>${error}</p>`);
          reject(new Error(error));
          return;
        }
        const state = url.searchParams.get('state');
        if (state !== expectedState) {
          sendHtml(res, 400, '<h1>Authorization failed</h1><p>Invalid state.</p>');
          reject(new Error('Invalid OAuth state'));
          return;
        }
        const authorizationCode = url.searchParams.get('code');
        if (!authorizationCode) {
          sendHtml(res, 400, '<h1>Authorization failed</h1><p>Missing authorization code.</p>');
          reject(new Error('Missing authorization code'));
          return;
        }
        sendHtml(res, 200, '<h1>Authorization complete</h1><p>You can return to Pulse Canvas.</p>');
        resolve(authorizationCode);
      } catch (err) {
        reject(err);
      }
    });

    server.on('error', reject);
    timer = setTimeout(() => reject(new Error('OAuth authorization timed out')), CALLBACK_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
  });

  const redirectUrl = await new Promise<string>((resolve, reject) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate OAuth callback port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}${CALLBACK_PATH}`);
    });
  });

  return {
    redirectUrl,
    code,
    close: async () => {
      if (timer) clearTimeout(timer);
      const current = server;
      server = null;
      if (!current) return;
      await new Promise<void>((resolve) => current.close(() => resolve()));
    },
  };
}

function oauthOptions(raw: OAuthOptionInput): OAuthOptions {
  return {
    clientId: typeof raw?.clientId === 'string' && raw.clientId.trim() ? raw.clientId.trim() : undefined,
    clientSecret: typeof raw?.clientSecret === 'string' && raw.clientSecret.trim()
      ? raw.clientSecret.trim()
      : undefined,
    scope: typeof raw?.scope === 'string' && raw.scope.trim() ? raw.scope.trim() : undefined,
  };
}

function makeClientMetadata(redirectUrl: string, options: OAuthOptions): OAuthClientMetadata {
  return {
    redirect_uris: [redirectUrl],
    token_endpoint_auth_method: options.clientSecret ? 'client_secret_post' : 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: 'Pulse Canvas',
    scope: options.scope,
  };
}

function makeProvider(
  serverName: string,
  rawOptions: OAuthOptionInput,
  callback?: { redirectUrl: string },
  state = randomBytes(24).toString('hex'),
): OAuthClientProvider {
  const options = oauthOptions(rawOptions);
  const redirectUrl = callback?.redirectUrl ?? 'http://127.0.0.1/oauth/callback';
  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return redirectUrl;
    },
    get clientMetadata() {
      return makeClientMetadata(redirectUrl, options);
    },
    async tokens() {
      return (await readRecord(serverName)).tokens;
    },
    async saveTokens(tokens) {
      await updateRecord(serverName, (record) => ({ ...record, tokens }));
    },
    async redirectToAuthorization(authorizationUrl) {
      if (!callback) {
        throw new Error('MCP OAuth connection required. Use Settings -> MCP -> Connect.');
      }
      await shell.openExternal(authorizationUrl.toString());
    },
    async saveCodeVerifier(codeVerifier) {
      await updateRecord(serverName, (record) => ({ ...record, codeVerifier, state }));
    },
    async codeVerifier() {
      const verifier = (await readRecord(serverName)).codeVerifier;
      if (!verifier) throw new Error('Missing OAuth code verifier');
      return verifier;
    },
    async clientInformation() {
      if (options.clientId) {
        return {
          client_id: options.clientId,
          client_secret: options.clientSecret,
        };
      }
      return (await readRecord(serverName)).clientInformation;
    },
    async state() {
      return state;
    },
    async invalidateCredentials(scope) {
      if (scope === 'all') {
        await clearCanvasMcpOAuth(serverName);
        return;
      }
      await updateRecord(serverName, (record) => {
        const next = { ...record };
        if (scope === 'tokens') delete next.tokens;
        if (scope === 'client') delete next.clientInformation;
        if (scope === 'verifier') delete next.codeVerifier;
        return next;
      });
    },
  };

  if (callback) {
    provider.saveClientInformation = async (clientInformation) => {
      await updateRecord(serverName, (record) => ({ ...record, clientInformation }));
    };
  }

  return provider;
}

export async function getCanvasMcpOAuthStatus(serverName: string): Promise<{
  connected: boolean;
  hasClientInformation: boolean;
}> {
  const record = await readRecord(serverName);
  return {
    connected: Boolean(record.tokens?.access_token || record.tokens?.refresh_token),
    hasClientInformation: Boolean(record.clientInformation?.client_id),
  };
}

export async function clearCanvasMcpOAuth(serverName: string): Promise<void> {
  const store = await readStore();
  const servers = { ...(store.servers ?? {}) };
  delete servers[serverKey(serverName)];
  await writeStore({ servers });
}

export async function createCanvasMcpOAuthProvider(
  serverName: string,
  rawOptions?: OAuthOptionInput,
): Promise<OAuthClientProvider> {
  return makeProvider(serverName, rawOptions);
}

export async function connectCanvasMcpOAuth(
  serverName: string,
  serverUrl: string,
  rawOptions?: OAuthOptionInput,
): Promise<void> {
  const options = oauthOptions(rawOptions);
  const state = randomBytes(24).toString('hex');
  const callback = await waitForAuthorizationCode(state);
  const provider = makeProvider(serverName, rawOptions, callback, state);

  try {
    if (!options.clientId) {
      await updateRecord(serverName, (record) => ({
        tokens: record.tokens,
      }));
    }

    const result = await mcpAuth(provider, { serverUrl });
    if (result !== 'REDIRECT') return;

    const authorizationCode = await callback.code;
    await mcpAuth(provider, { serverUrl, authorizationCode });
  } finally {
    await callback.close();
  }
}
