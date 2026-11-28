import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCanvasCompatibilityStore } from '@pulse-coder/storage/canvas';
import { startVpsDaemon, type RunningVpsDaemon } from './server.js';

describe('vps-daemon lightweight agent loop', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    delete process.env.PULSE_AGENT_API_KEY;
    delete process.env.PULSE_AGENT_BASE_URL;
    delete process.env.PULSE_AGENT_MODEL;
    delete process.env.PULSE_AGENT_PROVIDER;
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  it('discovers .pulse-coder/skills, executes canvas + bash + load_skill tools, streams SSE, and persists conversation', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vps-agent-test-'));
    cleanups.push(() => rm(tempRoot, { recursive: true, force: true }));
    const dataDir = join(tempRoot, 'data');
    const workDir = join(tempRoot, 'work');
    const skillDir = join(workDir, '.pulse-coder', 'skills', 'canvas-summary');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: canvas-summary\ndescription: Summarize canvas cards concisely\n---\nAlways create a Summary node on the canvas.\n',
      'utf8',
    );

    // Local mock OpenAI-compatible SSE server:
    // Step 1 -> emits tool calls for load_skill, canvas_create_node, and bash
    // Step 2 -> emits final assistant text
    let llmCallCount = 0;
    const mockLlm = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      llmCallCount += 1;

      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      if (llmCallCount === 1) {
        const calls = [
          { index: 0, id: 'call_skill', function: { name: 'load_skill', arguments: JSON.stringify({ name: 'canvas-summary' }) } },
          {
            index: 1,
            id: 'call_canvas',
            function: {
              name: 'canvas_create_node',
              arguments: JSON.stringify({ title: 'Summary', content: 'Created by VPS Agent' }),
            },
          },
          { index: 2, id: 'call_bash', function: { name: 'bash', arguments: JSON.stringify({ command: 'echo hello-vps' }) } },
        ];
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'All done! ' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Created the Summary node.' } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });

    await new Promise<void>((resolve) => mockLlm.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => mockLlm.close(() => resolve())));
    const llmAddr = mockLlm.address();
    const llmPort = typeof llmAddr === 'object' && llmAddr ? llmAddr.port : 0;

    process.env.PULSE_AGENT_PROVIDER = 'openai';
    process.env.PULSE_AGENT_API_KEY = 'test-key';
    process.env.PULSE_AGENT_BASE_URL = `http://127.0.0.1:${llmPort}/v1`;
    process.env.PULSE_AGENT_MODEL = 'mock-model';

    const daemon: RunningVpsDaemon = await startVpsDaemon({
      host: '127.0.0.1',
      port: 0,
      token: 'admin-token',
      dataDir,
      workDir,
    });
    cleanups.push(() => daemon.close());

    const authHeaders = {
      Authorization: 'Bearer admin-token',
      'Content-Type': 'application/json',
    };

    const statusRes = await fetch(`${daemon.url}/v1/agent/status`, { headers: authHeaders });
    const statusBody = (await statusRes.json()) as { ok: boolean; configured: boolean; skillsCount: number };
    expect(statusBody).toMatchObject({ ok: true, configured: true, skillsCount: 1 });

    const skillsRes = await fetch(`${daemon.url}/v1/agent/skills`, { headers: authHeaders });
    const skillsBody = (await skillsRes.json()) as { ok: boolean; skills: Array<{ name: string }> };
    expect(skillsBody.skills.map((s) => s.name)).toEqual(['canvas-summary']);

    const chatRes = await fetch(`${daemon.url}/v1/agent/chat`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        workspaceId: 'ws-agent',
        sessionId: 'sess-1',
        message: 'Summarize canvas and check environment',
      }),
    });
    expect(chatRes.status).toBe(200);
    const sseText = await chatRes.text();
    expect(sseText).toContain('event: tool_call');
    expect(sseText).toContain('"name":"load_skill"');
    expect(sseText).toContain('"name":"canvas_create_node"');
    expect(sseText).toContain('"name":"bash"');
    expect(sseText).toContain('hello-vps');
    expect(sseText).toContain('event: text_delta');
    expect(sseText).toContain('Created the Summary node.');
    expect(sseText).toContain('event: complete');

    // Verify canvas mutation persisted in SQLite storage.
    const canvasStore = createCanvasCompatibilityStore(daemon.storage.canvas);
    const canvas = await canvasStore.readCanvas('ws-agent');
    expect(canvas?.nodes).toHaveLength(1);
    expect(canvas?.nodes?.[0]).toMatchObject({ title: 'Summary', content: 'Created by VPS Agent' });

    // Verify conversation persisted in SQLite storage with Electron-compatible metadata.session header.
    const conv = await daemon.storage.conversations.read('ws-agent', 'sess-1');
    expect(conv?.messages).toHaveLength(2);
    expect(conv?.metadata?.session).toMatchObject({
      sessionId: 'sess-1',
      workspaceId: 'ws-agent',
    });
    expect(typeof (conv?.metadata?.session as { startedAt?: unknown })?.startedAt).toBe('string');

    // Verify viewer share token is blocked from POST /v1/agent/chat.
    const shareRes = await fetch(`${daemon.url}/v1/shares`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: 'ws-agent', role: 'viewer', label: 'ReadOnly' }),
    });
    const shareBody = (await shareRes.json()) as { share: { token: string } };
    const viewerChat = await fetch(`${daemon.url}/v1/agent/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${shareBody.share.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-agent', message: 'hi' }),
    });
    expect(viewerChat.status).toBe(403);
  });
});
