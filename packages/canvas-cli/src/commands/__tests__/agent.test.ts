import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { createServer, type Server } from 'http';
import { createCli } from '../../cli';

// All tests in this file write to ~/.pulse-coder/canvas-runtime/canvas-workspace.json
// since the CLI hard-codes that path. We back up any real file before each
// test and restore it afterwards so we don't clobber the user's live runtime.
const RUNTIME_FILE = join(homedir(), '.pulse-coder', 'canvas-runtime', 'canvas-workspace.json');
let backup: Buffer | null = null;

beforeEach(async () => {
  try {
    backup = await fs.readFile(RUNTIME_FILE);
  } catch {
    backup = null;
  }
  await fs.rm(RUNTIME_FILE, { force: true });
});

afterEach(async () => {
  if (backup) {
    await fs.mkdir(join(homedir(), '.pulse-coder', 'canvas-runtime'), { recursive: true });
    await fs.writeFile(RUNTIME_FILE, backup);
  } else {
    await fs.rm(RUNTIME_FILE, { force: true });
  }
});

async function writeRuntime(info: object): Promise<void> {
  await fs.mkdir(join(homedir(), '.pulse-coder', 'canvas-runtime'), { recursive: true });
  await fs.writeFile(RUNTIME_FILE, JSON.stringify(info));
}

function startStubServer(
  handler: (body: unknown, headers: Record<string, string | string[] | undefined>, url?: string) =>
    { status: number; body: unknown },
): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        } catch {}
        const { status, body } = handler(parsed, req.headers, req.url);
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr !== 'object') throw new Error('listen failed');
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function runCli(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    stdout.push(args.map(String).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderr.push(args.map(String).join(' '));
  });
  let exitCode: number | null = null;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__exit:${code}`);
  }) as never);

  const cli = createCli();
  cli.exitOverride();
  try {
    await cli.parseAsync(argv, { from: 'user' });
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('__exit:')) {
      // commander errors hit here too — treat as exit
    }
  }
  logSpy.mockRestore();
  errSpy.mockRestore();
  exitSpy.mockRestore();
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode };
}

describe('pulse-canvas agent send', () => {
  it('fails when runtime file is missing', async () => {
    const { stderr, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'agent', 'send', 'node-1', '--input', 'hi',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/No active canvas-workspace runtime found/);
  });

  it('fails when runtime file is corrupt', async () => {
    await writeRuntime({} as unknown as object);
    const { stderr, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'agent', 'send', 'node-1', '--input', 'hi',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/missing baseUrl or secret|corrupt/);
  });

  it('reports 401 with a clear hint', async () => {
    const { server, baseUrl } = await startStubServer(() => ({
      status: 401, body: { ok: false, error: 'unauthorized' },
    }));
    await writeRuntime({ pid: process.pid, baseUrl, secret: 'wrong', createdAt: '' });
    const { stderr, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'agent', 'send', 'node-1', '--input', 'hi',
    ]);
    server.close();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Runtime authentication failed/);
  });

  it('reports connection failure clearly', async () => {
    await writeRuntime({ pid: process.pid, baseUrl: 'http://127.0.0.1:1', secret: 's', createdAt: '' });
    const { stderr, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'agent', 'send', 'node-1', '--input', 'hi',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Cannot reach canvas-workspace runtime/);
  });

  it('happy path: posts to /agent/send with bearer auth and prints OK', async () => {
    let seenAuth = '';
    let seenBody: unknown = null;
    const { server, baseUrl } = await startStubServer((body, headers) => {
      seenAuth = String(headers['authorization'] ?? '');
      seenBody = body;
      return { status: 200, body: { ok: true, nodeId: 'node-1', bytesSent: 3 } };
    });
    await writeRuntime({ pid: process.pid, baseUrl, secret: 'tok', createdAt: '' });
    const { stdout, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'agent', 'send', 'node-1', '--input', 'hi',
    ]);
    server.close();

    expect(exitCode).toBe(null);
    expect(seenAuth).toBe('Bearer tok');
    expect(seenBody).toEqual({ workspaceId: 'ws-x', nodeId: 'node-1', input: 'hi' });
    expect(stdout).toMatch(/OK \(sent 3 bytes to node-1\)/);
  });
});

describe('pulse-canvas team propose-plan', () => {
  it('posts structured plans to /agent-team/propose-plan', async () => {
    const planPath = join(tmpdir(), `pulse-canvas-plan-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const plan = {
      summary: 'Split the UI polish into implementation and review.',
      teammates: [{ name: 'Codex Exec', agentType: 'codex' }],
      tasks: [{ title: 'Polish UI', description: 'Tighten the layout.', ownerName: 'Codex Exec' }],
    };
    await fs.writeFile(planPath, JSON.stringify(plan), 'utf-8');

    let seenAuth = '';
    let seenBody: unknown = null;
    let seenUrl = '';
    const { server, baseUrl } = await startStubServer((body, headers, url) => {
      seenAuth = String(headers['authorization'] ?? '');
      seenBody = body;
      seenUrl = url ?? '';
      return {
        status: 200,
        body: {
          ok: true,
          snapshot: {
            runtime: { team: { id: 'team-1', name: 'Agent Team' } },
            pendingPlan: plan,
          },
        },
      };
    });
    await writeRuntime({ pid: process.pid, baseUrl, secret: 'tok', createdAt: '' });

    const { stdout, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'team', 'propose-plan',
      '--team', 'team-1',
      '--source-agent', 'lead-1',
      '--plan-file', planPath,
    ]);
    server.close();
    await fs.rm(planPath, { force: true });

    expect(exitCode).toBe(null);
    expect(seenUrl).toBe('/agent-team/propose-plan');
    expect(seenAuth).toBe('Bearer tok');
    expect(seenBody).toEqual({
      workspaceId: 'ws-x',
      teamId: 'team-1',
      sourceAgentId: 'lead-1',
      plan,
    });
    expect(stdout).toMatch(/Plan proposed for Agent Team: 1 teammates, 1 tasks\./);
  });

  it('uses team environment defaults when flags are omitted', async () => {
    const oldTeam = process.env.PULSE_CANVAS_TEAM_ID;
    const oldAgent = process.env.PULSE_CANVAS_TEAM_AGENT_ID;
    process.env.PULSE_CANVAS_TEAM_ID = 'team-env';
    process.env.PULSE_CANVAS_TEAM_AGENT_ID = 'lead-env';
    let seenBody: unknown = null;
    const { server, baseUrl } = await startStubServer((body) => {
      seenBody = body;
      return {
        status: 200,
        body: {
          ok: true,
          snapshot: {
            runtime: { team: { id: 'team-env', name: 'Env Team' } },
            pendingPlan: { teammates: [], tasks: [] },
          },
        },
      };
    });
    await writeRuntime({ pid: process.pid, baseUrl, secret: 'tok', createdAt: '' });

    const { exitCode } = await runCli([
      '--workspace', 'ws-x',
      'team', 'propose-plan',
      '--plan-json', '{"summary":"Plan from env"}',
    ]);
    server.close();
    if (oldTeam == null) delete process.env.PULSE_CANVAS_TEAM_ID;
    else process.env.PULSE_CANVAS_TEAM_ID = oldTeam;
    if (oldAgent == null) delete process.env.PULSE_CANVAS_TEAM_AGENT_ID;
    else process.env.PULSE_CANVAS_TEAM_AGENT_ID = oldAgent;

    expect(exitCode).toBe(null);
    expect(seenBody).toMatchObject({
      workspaceId: 'ws-x',
      teamId: 'team-env',
      sourceAgentId: 'lead-env',
      plan: { summary: 'Plan from env' },
    });
  });
});

describe('pulse-canvas team follow-up actions', () => {
  it('creates follow-up tasks through /agent-team/create-task', async () => {
    let seenBody: unknown = null;
    let seenUrl = '';
    const { server, baseUrl } = await startStubServer((body, _headers, url) => {
      seenBody = body;
      seenUrl = url ?? '';
      return {
        status: 200,
        body: {
          ok: true,
          snapshot: {
            runtime: { team: { id: 'team-1', name: 'Agent Team', status: 'running' }, tasks: [] },
          },
        },
      };
    });
    await writeRuntime({ pid: process.pid, baseUrl, secret: 'tok', createdAt: '' });

    const { stdout, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'team', 'create-task',
      '--team', 'team-1',
      '--title', 'Adjust checkout copy',
      '--description', 'Update frontend copy after backend change.',
      '--owner', 'Codex Frontend',
      '--dep', 'Define backend API',
      '--dispatch',
    ]);
    server.close();

    expect(exitCode).toBe(null);
    expect(seenUrl).toBe('/agent-team/create-task');
    expect(seenBody).toEqual({
      workspaceId: 'ws-x',
      teamId: 'team-1',
      title: 'Adjust checkout copy',
      description: 'Update frontend copy after backend change.',
      ownerName: 'Codex Frontend',
      depRefs: ['Define backend API'],
      dispatch: true,
    });
    expect(stdout).toMatch(/Task created for Agent Team and dispatch requested\./);
  });

  it('dispatches ready tasks through /agent-team/dispatch', async () => {
    let seenBody: unknown = null;
    let seenUrl = '';
    const { server, baseUrl } = await startStubServer((body, _headers, url) => {
      seenBody = body;
      seenUrl = url ?? '';
      return {
        status: 200,
        body: {
          ok: true,
          snapshot: {
            runtime: { team: { id: 'team-1', name: 'Agent Team', status: 'running' } },
          },
        },
      };
    });
    await writeRuntime({ pid: process.pid, baseUrl, secret: 'tok', createdAt: '' });

    const { stdout, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'team', 'dispatch',
      '--team', 'team-1',
    ]);
    server.close();

    expect(exitCode).toBe(null);
    expect(seenUrl).toBe('/agent-team/dispatch');
    expect(seenBody).toEqual({ workspaceId: 'ws-x', teamId: 'team-1' });
    expect(stdout).toMatch(/Dispatch checked for Agent Team \(running\)\./);
  });

  it('sends team messages through /agent-team/send', async () => {
    let seenBody: unknown = null;
    let seenUrl = '';
    const { server, baseUrl } = await startStubServer((body, _headers, url) => {
      seenBody = body;
      seenUrl = url ?? '';
      return {
        status: 200,
        body: {
          ok: true,
          snapshot: {
            runtime: { team: { id: 'team-1', name: 'Agent Team', status: 'running' } },
          },
        },
      };
    });
    await writeRuntime({ pid: process.pid, baseUrl, secret: 'tok', createdAt: '' });

    const { stdout, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'team', 'send',
      '--team', 'team-1',
      '--to', 'Codex Frontend',
      'Use the stable checkout API.',
    ]);
    server.close();

    expect(exitCode).toBe(null);
    expect(seenUrl).toBe('/agent-team/send');
    expect(seenBody).toEqual({
      workspaceId: 'ws-x',
      teamId: 'team-1',
      to: 'Codex Frontend',
      content: 'Use the stable checkout API.',
    });
    expect(stdout).toMatch(/Message sent in Agent Team to Codex Frontend\./);
  });

  it('posts teammate lifecycle actions through team runtime endpoints', async () => {
    const oldAgent = process.env.PULSE_CANVAS_TEAM_AGENT_ID;
    process.env.PULSE_CANVAS_TEAM_AGENT_ID = 'agent-env';
    const requests: Array<{ url: string; body: unknown }> = [];
    const { server, baseUrl } = await startStubServer((body, _headers, url) => {
      requests.push({ url: url ?? '', body });
      return {
        status: 200,
        body: {
          ok: true,
          snapshot: {
            runtime: { team: { id: 'team-1', name: 'Agent Team', status: 'running' } },
          },
        },
      };
    });
    await writeRuntime({ pid: process.pid, baseUrl, secret: 'tok', createdAt: '' });

    const completeTask = await runCli([
      '--workspace', 'ws-x',
      'team', 'complete-task',
      '--team', 'team-1',
      '--task', 'Implement checkout refactor',
      'Checkout implementation is done.',
    ]);
    const blockTask = await runCli([
      '--workspace', 'ws-x',
      'team', 'block-task',
      '--team', 'team-1',
      '--source-agent', 'agent-blocker',
      '--task', 'Review checkout refactor',
      'Waiting for API docs.',
    ]);
    const requestHumanInput = await runCli([
      '--workspace', 'ws-x',
      'team', 'request-human-input',
      '--team', 'team-1',
      '--task', 'Review checkout refactor',
      '--reason', 'Need product decision',
      'Should the checkout copy mention the beta API?',
    ]);
    const publishArtifact = await runCli([
      '--workspace', 'ws-x',
      'team', 'publish-artifact',
      '--team', 'team-1',
      '--task', 'Implement checkout refactor',
      '--kind', 'summary',
      '--title', 'api-contract.md',
      'Stable API contract documented.',
    ]);
    const completeTeam = await runCli([
      '--workspace', 'ws-x',
      'team', 'complete-team',
      '--team', 'team-1',
      'Checkout work completed and reviewed.',
    ]);
    server.close();
    if (oldAgent == null) delete process.env.PULSE_CANVAS_TEAM_AGENT_ID;
    else process.env.PULSE_CANVAS_TEAM_AGENT_ID = oldAgent;

    expect(completeTask.exitCode).toBe(null);
    expect(blockTask.exitCode).toBe(null);
    expect(requestHumanInput.exitCode).toBe(null);
    expect(publishArtifact.exitCode).toBe(null);
    expect(completeTeam.exitCode).toBe(null);
    expect(requests).toEqual([
      {
        url: '/agent-team/complete-task',
        body: {
          workspaceId: 'ws-x',
          teamId: 'team-1',
          sourceAgentId: 'agent-env',
          taskId: 'Implement checkout refactor',
          summary: 'Checkout implementation is done.',
        },
      },
      {
        url: '/agent-team/block-task',
        body: {
          workspaceId: 'ws-x',
          teamId: 'team-1',
          sourceAgentId: 'agent-blocker',
          taskId: 'Review checkout refactor',
          reason: 'Waiting for API docs.',
        },
      },
      {
        url: '/agent-team/request-human-input',
        body: {
          workspaceId: 'ws-x',
          teamId: 'team-1',
          sourceAgentId: 'agent-env',
          taskId: 'Review checkout refactor',
          reason: 'Need product decision',
          prompt: 'Should the checkout copy mention the beta API?',
        },
      },
      {
        url: '/agent-team/publish-artifact',
        body: {
          workspaceId: 'ws-x',
          teamId: 'team-1',
          sourceAgentId: 'agent-env',
          taskId: 'Implement checkout refactor',
          kind: 'summary',
          title: 'api-contract.md',
          summary: 'Stable API contract documented.',
        },
      },
      {
        url: '/agent-team/complete-team',
        body: {
          workspaceId: 'ws-x',
          teamId: 'team-1',
          sourceAgentId: 'agent-env',
          summary: 'Checkout work completed and reviewed.',
        },
      },
    ]);
  });
});
