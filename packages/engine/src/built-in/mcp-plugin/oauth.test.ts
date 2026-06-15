import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// `auth` is the only @ai-sdk/mcp value authorizeMcpServer calls; the provider
// itself only persists state. Mock it so we can drive the two-leg flow.
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@ai-sdk/mcp', () => ({
  auth: authMock,
  UnauthorizedError: class UnauthorizedError extends Error {},
  createMCPClient: vi.fn(),
}));

import {
  createFileOAuthProvider,
  authorizeMcpServer,
  type OAuthCipher,
} from './oauth';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'mcp-oauth-test-'));
  filePath = join(dir, 'github.json');
  authMock.mockReset();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function makeProvider(overrides: Partial<Parameters<typeof createFileOAuthProvider>[0]> = {}) {
  return createFileOAuthProvider({
    filePath,
    redirectUrl: 'http://127.0.0.1:33418/callback',
    clientName: 'Pulse Canvas',
    scopes: ['read', 'write'],
    redirectToAuthorization: () => {},
    ...overrides,
  });
}

describe('createFileOAuthProvider storage', () => {
  it('round-trips tokens, client info, and the PKCE verifier', async () => {
    const provider = makeProvider();

    expect(await provider.tokens()).toBeUndefined();
    await provider.saveTokens({ access_token: 'tok', token_type: 'bearer' });
    expect(await provider.tokens()).toMatchObject({ access_token: 'tok' });

    await provider.saveClientInformation?.({ client_id: 'cid' });
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'cid' });

    await provider.saveCodeVerifier('verifier-123');
    expect(await provider.codeVerifier()).toBe('verifier-123');

    // File is owner-only and survives a fresh provider over the same path.
    const reopened = makeProvider();
    expect(await reopened.tokens()).toMatchObject({ access_token: 'tok' });
  });

  it('throws when no code verifier has been stored yet', async () => {
    const provider = makeProvider();
    await expect(provider.codeVerifier()).rejects.toThrow(/code verifier/i);
  });

  it('exposes a stable client metadata document', () => {
    const provider = makeProvider();
    expect(provider.clientMetadata).toMatchObject({
      client_name: 'Pulse Canvas',
      redirect_uris: ['http://127.0.0.1:33418/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'read write',
    });
  });

  it('returns a fixed CSRF state when one is supplied and persists it', async () => {
    const provider = makeProvider({ state: 'fixed-state' });
    expect(await provider.state?.()).toBe('fixed-state');
    expect(await provider.state?.()).toBe('fixed-state');
  });

  it('invalidateCredentials("all") clears the record', async () => {
    const provider = makeProvider();
    await provider.saveTokens({ access_token: 'tok', token_type: 'bearer' });
    await provider.invalidateCredentials?.('all');
    expect(await provider.tokens()).toBeUndefined();
  });
});

describe('createFileOAuthProvider at-rest encryption', () => {
  // A trivially reversible cipher — enough to assert the plaintext token never
  // lands in the file and that a wrong/absent key reads as "not authorized".
  const cipher: OAuthCipher = {
    encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
    decrypt: (blob) => Buffer.from(blob, 'base64').toString('utf8'),
  };

  it('does not write the raw token to disk and reads it back via the cipher', async () => {
    const provider = makeProvider({ cipher });
    await provider.saveTokens({ access_token: 'super-secret', token_type: 'bearer' });

    const onDisk = await fs.readFile(filePath, 'utf8');
    expect(onDisk).not.toContain('super-secret');
    expect(JSON.parse(onDisk)).toMatchObject({ enc: true });

    const reopened = makeProvider({ cipher });
    expect(await reopened.tokens()).toMatchObject({ access_token: 'super-secret' });
  });

  it('treats an encrypted file as absent when no key is available', async () => {
    const enc = makeProvider({ cipher });
    await enc.saveTokens({ access_token: 'secret', token_type: 'bearer' });

    const noKey = makeProvider(); // cipher omitted
    expect(await noKey.tokens()).toBeUndefined();
  });
});

describe('authorizeMcpServer', () => {
  it('drives the two-leg authorization-code flow', async () => {
    const provider = makeProvider({ state: 'expected' });
    authMock
      .mockResolvedValueOnce('REDIRECT') // leg 1: discovery + redirect
      .mockResolvedValueOnce('AUTHORIZED'); // leg 2: code exchange

    await authorizeMcpServer(provider, {
      serverUrl: 'https://mcp.example.com',
      scope: 'read write',
      expectedState: 'expected',
      waitForCallback: async () => ({ code: 'auth-code', state: 'expected' }),
    });

    expect(authMock).toHaveBeenCalledTimes(2);
    expect(authMock.mock.calls[1][1]).toMatchObject({ authorizationCode: 'auth-code' });
  });

  it('short-circuits when a valid token already exists', async () => {
    const provider = makeProvider();
    authMock.mockResolvedValueOnce('AUTHORIZED');
    const waitForCallback = vi.fn();

    await authorizeMcpServer(provider, {
      serverUrl: 'https://mcp.example.com',
      waitForCallback,
    });

    expect(authMock).toHaveBeenCalledTimes(1);
    expect(waitForCallback).not.toHaveBeenCalled();
  });

  it('aborts on a CSRF state mismatch', async () => {
    const provider = makeProvider({ state: 'expected' });
    authMock.mockResolvedValueOnce('REDIRECT');

    await expect(
      authorizeMcpServer(provider, {
        serverUrl: 'https://mcp.example.com',
        expectedState: 'expected',
        waitForCallback: async () => ({ code: 'auth-code', state: 'tampered' }),
      }),
    ).rejects.toThrow(/state mismatch/i);
    expect(authMock).toHaveBeenCalledTimes(1);
  });
});
