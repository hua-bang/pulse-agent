import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { createServer, type Server } from 'http';
import { homedir } from 'os';
import { join } from 'path';

import {
  callRuntimeCapability,
  listRuntimeCapabilities,
} from './runtime-capabilities';


const runtimeHome = await vi.hoisted(async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return mkdtemp(join(tmpdir(), 'canvas-cli-runtime-test-'));
});
vi.mock('os', async (importOriginal) => ({
  ...await importOriginal<typeof import('os')>(),
  homedir: () => runtimeHome,
}));
afterAll(async () => { await fs.rm(runtimeHome, { recursive: true, force: true }); });

const runtimeFile = join(homedir(), '.pulse-coder', 'canvas-runtime', 'canvas-workspace.json');

beforeEach(async () => {
  await fs.rm(runtimeFile, { force: true });
});

afterEach(async () => {
  await fs.rm(runtimeFile, { force: true });
});

async function startStub(
  handler: (url: string, body: unknown, auth: string) => { status: number; body: unknown },
): Promise<{ server: Server; baseUrl: string }> {
  return await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        const response = handler(
          req.url ?? '',
          JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'),
          String(req.headers.authorization ?? ''),
        );
        res.statusCode = response.status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(response.body));
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') throw new Error('listen failed');
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function advertise(baseUrl: string, secret = 'secret'): Promise<void> {
  await fs.mkdir(join(homedir(), '.pulse-coder', 'canvas-runtime'), { recursive: true });
  await fs.writeFile(runtimeFile, JSON.stringify({
    pid: process.pid,
    baseUrl,
    secret,
    createdAt: new Date().toISOString(),
  }));
}

describe('runtime capability client', () => {
  it('returns a structured error instead of exiting when no runtime is active', async () => {
    await expect(listRuntimeCapabilities()).resolves.toEqual({
      ok: false,
      error: {
        code: 'runtime_not_found',
        message: 'No active canvas-workspace runtime found.',
      },
    });
  });

  it('lists capabilities using the advertised bearer secret', async () => {
    const { server, baseUrl } = await startStub((url, body, auth) => {
      expect(url).toBe('/capabilities/list');
      expect(body).toEqual({});
      expect(auth).toBe('Bearer secret');
      return {
        status: 200,
        body: {
          ok: true,
          capabilities: [
            {
              name: 'browser.tabs.list',
              description: 'List tabs.',
              risk: 'read',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      };
    });
    await advertise(baseUrl);

    await expect(listRuntimeCapabilities()).resolves.toEqual({
      ok: true,
      value: [
        {
          name: 'browser.tabs.list',
          description: 'List tabs.',
          risk: 'read',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });
    server.close();
  });

  it('calls a capability with workspace context and preserves structured failures', async () => {
    const { server, baseUrl } = await startStub((url, body) => {
      expect(url).toBe('/capabilities/call');
      expect(body).toEqual({
        workspaceId: 'ws-1',
        name: 'browser.tabs.activate',
        input: { tabId: 'missing' },
      });
      return {
        status: 409,
        body: {
          ok: false,
          error: { code: 'tab_not_found', message: 'Tab missing is not open.' },
        },
      };
    });
    await advertise(baseUrl);

    await expect(callRuntimeCapability({
      workspaceId: 'ws-1',
      name: 'browser.tabs.activate',
      input: { tabId: 'missing' },
    })).resolves.toEqual({
      ok: false,
      error: { code: 'tab_not_found', message: 'Tab missing is not open.' },
    });
    server.close();
  });
});
