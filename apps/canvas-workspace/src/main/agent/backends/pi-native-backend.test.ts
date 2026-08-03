import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeCanvasAgentSegment } from '../segment-execution';
import { renderPiNativePrompt, resolvePiExtensionPath } from './pi-native-backend';

let dir: string;

/** Executable fake `pi`: succeeds fresh, fails resumes with a stale-session error. */
function installFakePi(): string {
  const path = join(dir, 'fake-pi');
  writeFileSync(path, [
    '#!/usr/bin/env node',
    "let input = '';",
    "process.stdin.on('data', (c) => { input += c; });",
    "process.stdin.on('end', () => {",
    "  if (process.argv.includes('--session')) {",
    "    process.stderr.write('No session found matching stale-id');",
    '    process.exit(1);',
    '  }',
    "  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
    "  out({ type: 'session', version: 3, id: 'pi-native-sess', timestamp: 't', cwd: process.cwd() });",
    "  out({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: '好的,' } });",
    "  out({ type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'bash', args: { command: 'ls' } });",
    "  out({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'bash', result: 'README.md', isError: false });",
    "  const provider = process.argv.includes('--provider') ? process.argv[process.argv.indexOf('--provider') + 1] : 'own';",
    "  const bridge = 'ws=' + (process.env.PULSE_CANVAS_WORKSPACE_ID || 'none') + ' ext=' + process.argv.includes('-e') + ' provider=' + provider + ' dir=' + Boolean(process.env.PI_CODING_AGENT_DIR);",
    "  out({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '好的,已完成。' + bridge }] } });",
    '});',
  ].join('\n'));
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canvas-pi-native-'));
  process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE = join(dir, 'state.json');
  process.env.PULSE_CANVAS_PI_NATIVE_CHAT = '1';
  process.env.PULSE_CANVAS_PI_CMD = installFakePi();
  process.env.PULSE_CANVAS_PI_BRIDGE_DIR = join(dir, 'pi-agent');
  // Pin the model-config source so the bridge never sees the test machine's
  // real config or ambient provider keys: default = keyless (bridge off).
  writeFileSync(join(dir, 'no-bridge-config.json'), JSON.stringify({
    api_key_env: 'PULSE_TEST_UNSET_KEY',
  }));
  process.env.PULSE_CANVAS_MODEL_CONFIG = join(dir, 'no-bridge-config.json');
});

afterEach(() => {
  delete process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE;
  delete process.env.PULSE_CANVAS_PI_NATIVE_CHAT;
  delete process.env.PULSE_CANVAS_PI_CMD;
  delete process.env.PULSE_CANVAS_PI_BRIDGE_DIR;
  delete process.env.PULSE_CANVAS_MODEL_CONFIG;
  rmSync(dir, { recursive: true, force: true });
});

const segmentOptions = (over: Record<string, unknown> = {}) => ({
  engine: {} as never,
  context: { messages: [] },
  role: null,
  chatSessionId: 'chat-native',
  workspaceRootFolder: dir,
  history: [
    { role: 'user' as const, content: '之前的问题' },
    { role: 'assistant' as const, content: '之前的回答' },
  ] as never,
  currentAsk: '看看目录',
  handoffNames: [],
  abortSignal: new AbortController().signal,
  executionMode: 'auto' as const,
  onText: vi.fn(),
  modelConfig: {
    providerType: 'openai' as const,
    provider: vi.fn(),
    model: 'test-model',
    modelLabel: 'Test model',
  },
  systemPrompt: 'system',
  appendMessages: vi.fn(),
  replaceMessages: vi.fn(),
  ...over,
});

describe('pi native backend (default assistant on pi)', () => {
  it('runs a workspace chat on pi WITH the canvas bridge attached', async () => {
    const appended: unknown[] = [];
    const live: string[] = [];
    const result = await executeCanvasAgentSegment(segmentOptions({
      workspaceId: 'ws-test',
      appendMessages: (messages: unknown[]) => appended.push(...messages),
      onToolCall: (e: { name: string }) => live.push(`call:${e.name}`),
      onToolResult: (e: { name: string }) => live.push(`result:${e.name}`),
    }) as never);

    // The fake pi echoes its workspace binding, -e presence, and model
    // pinning — proving env + extension + model-bridge args reach the spawn.
    expect(result.resultText).toBe('好的,已完成。ws=ws-test ext=true provider=own dir=false');
    expect(result.streamedText).toBe('好的,');
    expect(live).toEqual(['call:bash', 'result:bash']);
    expect(result.externalToolCalls).toEqual([
      { id: 1, name: 'bash', toolCallId: 'tc1', status: 'succeeded', args: { command: 'ls' }, result: 'README.md' },
    ]);
    expect(appended).toEqual([
      { role: 'assistant', content: '好的,已完成。ws=ws-test ext=true provider=own dir=false' },
    ]);
  });

  it('pins the canvas model onto pi when the config carries a key (model-parity bridge)', async () => {
    writeFileSync(join(dir, 'bridge-config.json'), JSON.stringify({
      current_provider: 'deepseek',
      current_model: 'deepseek-chat',
      providers: [{
        id: 'deepseek',
        name: 'DeepSeek',
        provider_type: 'openai',
        base_url: 'https://api.deepseek.com/v1',
        encrypted_api_key: `plain:${Buffer.from('sk-third-party', 'utf8').toString('base64')}`,
        models: [{ id: 'deepseek-chat' }],
      }],
    }));
    process.env.PULSE_CANVAS_MODEL_CONFIG = join(dir, 'bridge-config.json');

    const result = await executeCanvasAgentSegment(segmentOptions({ workspaceId: 'ws-test' }) as never);
    expect(result.resultText).toBe('好的,已完成。ws=ws-test ext=true provider=canvas dir=true');
  });

  it('runs a workspace-less (global/scheduled) chat bare — no bridge, no env', async () => {
    const result = await executeCanvasAgentSegment(segmentOptions() as never);
    expect(result.resultText).toBe('好的,已完成。ws=none ext=false provider=own dir=false');
  });

  it('persists the announced session id and survives a stale resume via the shared retry', async () => {
    await executeCanvasAgentSegment(segmentOptions() as never);
    // Second turn resumes with the stored id; the fake fails resumes with a
    // stale-session error, so the retry runs once fresh and still succeeds.
    const second = await executeCanvasAgentSegment(segmentOptions({ currentAsk: '再来一次' }) as never);
    expect(second.resultText).toBe('好的,已完成。ws=none ext=false provider=own dir=false');
  });
});

describe('resolvePiExtensionPath', () => {
  it('honors the env override and falls back to the repo resources copy', () => {
    process.env.PULSE_CANVAS_PI_EXTENSION = '/does/not/exist.ts';
    expect(resolvePiExtensionPath()).toBeUndefined();
    delete process.env.PULSE_CANVAS_PI_EXTENSION;
    // vitest runs with cwd = apps/canvas-workspace, so the shipped file resolves.
    expect(resolvePiExtensionPath()).toMatch(/resources[/\\]pi-extension[/\\]pulse-canvas\.ts$/);
  });
});

describe('renderPiNativePrompt', () => {
  it('renders a native assistant prompt with a labeled window and the ask', () => {
    const prompt = renderPiNativePrompt({
      cwd: '/w',
      history: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好!' },
      ] as never,
      currentAsk: '继续',
      resumed: false,
    });
    expect(prompt).toContain('AI 助手');
    expect(prompt).toContain('用户: 你好');
    expect(prompt).toContain('助手: 你好!');
    expect(prompt).toContain('## 本轮请求\n继续');
    expect(prompt).not.toContain('群聊');
  });

  it('marks the window as possibly-overlapping on resume', () => {
    const prompt = renderPiNativePrompt({ cwd: '/w', history: [] as never, currentAsk: 'x', resumed: true });
    expect(prompt).toContain('可能与你会话里已知的内容有重叠');
    expect(prompt).toContain('(这是本对话的第一条消息)');
  });
});
