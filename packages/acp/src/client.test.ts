import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AcpClient, AcpTimeoutError } from './client.js';

const clients: AcpClient[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.kill();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('AcpClient', () => {
  it('rejects timed calls and cleans up pending state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-acp-client-'));
    tempDirs.push(dir);
    const childPath = join(dir, 'silent-child.cjs');
    await writeFile(childPath, 'process.stdin.resume(); setTimeout(() => {}, 60000);\n');

    const client = new AcpClient('codex', dir, {
      commandOverrides: { codex: `${process.execPath} ${childPath}` },
    });
    clients.push(client);

    await expect(client.call('session/prompt', {}, 10)).rejects.toBeInstanceOf(AcpTimeoutError);
    expect((client as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
  });
});
