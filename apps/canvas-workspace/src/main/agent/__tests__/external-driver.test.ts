import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { AgentRoleDefinition } from '../../../shared/agent-roles';
import { consumeClaudeStreamLine, createClaudeStreamState, runClaudeCodeSegment } from '../external/claude-code';
import { resolveExternalCwd } from '../external/cwd';
import { buildCodexArgs, consumeCodexStreamLine, createCodexStreamState, runCodexSegment } from '../external/codex';
import { renderExternalSegmentPrompt } from '../external/prompt';
import { runExternalRoleSegment } from '../external/segment';
import { getExternalSessionId, saveExternalSessionId } from '../external/state-store';
import { handoffTargetRoles } from '../role-turn';

let dir: string;

const role = (over: Partial<AgentRoleDefinition> = {}): AgentRoleDefinition => ({
  id: 'r-ext', name: 'Claude工程师', color: '#2383e2', prompt: '你负责把评审意见落成代码。',
  external: { family: 'claude-code', cwd: '/tmp/project' },
  createdAt: 0, updatedAt: 0,
  ...over,
});

/** Executable fake `claude`: succeeds fresh, fails resumes with a stale-session error. */
function installFakeClaude(name = 'fake-claude'): string {
  const path = join(dir, name);
  writeFileSync(path, [
    '#!/usr/bin/env node',
    "let input = '';",
    "process.stdin.on('data', (c) => { input += c; });",
    "process.stdin.on('end', () => {",
    "  if (process.argv.includes('--resume')) {",
    "    process.stderr.write('No conversation found with session ID sess-old');",
    '    process.exit(1);',
    '  }',
    "  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
    "  out({ type: 'system', subtype: 'init', session_id: 'sess-new' });",
    "  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '改完了,' } } });",
    "  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '细节见 diff。' } } });",
    "  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'DUPLICATE-IGNORED' }] } });",
    "  out({ type: 'result', subtype: 'success', result: '改完了,细节见 diff。prompt_bytes=' + input.length, session_id: 'sess-new' });",
    '});',
  ].join('\n'));
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canvas-external-'));
  process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE = join(dir, 'state.json');
});

afterEach(() => {
  delete process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE;
  delete process.env.PULSE_CANVAS_EXTERNAL_AGENT_HOME;
  delete process.env.PULSE_CANVAS_CLAUDE_CODE_CMD;
  rmSync(dir, { recursive: true, force: true });
});

describe('claude stream-json parser', () => {
  it('streams token partials, ignores duplicate full texts, prefers the result text', () => {
    const state = createClaudeStreamState();
    const deltas: string[] = [];
    const feed = (obj: unknown) => consumeClaudeStreamLine(state, JSON.stringify(obj), d => deltas.push(d));

    feed({ type: 'system', subtype: 'init', session_id: 'sess-1' });
    feed({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A' } } });
    feed({ type: 'assistant', message: { content: [{ type: 'text', text: 'AB-full' }] } });
    feed({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'B' } } });
    consumeClaudeStreamLine(state, 'not json at all', d => deltas.push(d));
    feed({ type: 'result', subtype: 'success', result: 'AB', session_id: 'sess-1' });

    expect(deltas).toEqual(['A', 'B']);
    expect(state.sessionId).toBe('sess-1');
    expect(state.resultText).toBe('AB');
    expect(state.errorMessage).toBeUndefined();
  });

  it('falls back to full assistant texts when no partials arrive, and surfaces error results', () => {
    const state = createClaudeStreamState();
    const deltas: string[] = [];
    const feed = (obj: unknown) => consumeClaudeStreamLine(state, JSON.stringify(obj), d => deltas.push(d));

    feed({ type: 'assistant', message: { content: [{ type: 'text', text: '第一段' }] } });
    feed({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'sess-2' });

    expect(deltas).toEqual(['第一段']);
    expect(state.errorMessage).toMatch(/error_during_execution/);
  });
});

describe('external session state store', () => {
  it('round-trips per (chat session × role) and invalidates on family/cwd change', async () => {
    const r = role();
    // The state store takes the RESOLVED driver ref — cwd is always concrete here.
    const resolved = { id: r.id, external: { family: 'claude-code' as const, cwd: '/tmp/project' } };
    await saveExternalSessionId('chat-1', resolved, 'sess-9');
    expect(await getExternalSessionId('chat-1', resolved)).toBe('sess-9');
    expect(await getExternalSessionId('chat-2', resolved)).toBeUndefined();
    expect(await getExternalSessionId('chat-1', { id: r.id, external: { family: 'claude-code', cwd: '/elsewhere' } })).toBeUndefined();
    expect(await getExternalSessionId('chat-1', { id: r.id, external: { family: 'codex', cwd: '/tmp/project' } })).toBeUndefined();
  });
});

describe('external segment prompt', () => {
  it('labels the discussion window and advertises handoff names excluding self', () => {
    const prompt = renderExternalSegmentPrompt({
      role: role(),
      cwd: '/tmp/project',
      history: [
        { role: 'user', content: '一起评审这个方案', timestamp: 1 },
        { role: 'assistant', content: '有两个风险。', timestamp: 2, speakerRoleName: '评审员' },
        { role: 'assistant', content: '好的。', timestamp: 3 },
      ],
      currentAsk: '把评审员挑的问题修掉',
      handoffNames: ['Claude工程师', '评审员'],
      resumed: true,
    });

    expect(prompt).toContain('用户: 一起评审这个方案');
    expect(prompt).toContain('【评审员】: 有两个风险。');
    expect(prompt).toContain('「助手」: 好的。');
    expect(prompt).toContain('@评审员');
    expect(prompt).not.toContain('@Claude工程师');
    expect(prompt).toContain('可能与你会话里已知的内容有重叠');
    expect(prompt).toContain('把评审员挑的问题修掉');
  });
});

describe('claude-code adapter + segment orchestration (fake CLI)', () => {
  it('streams deltas, captures the session id, and pipes the prompt via stdin', async () => {
    process.env.PULSE_CANVAS_CLAUDE_CODE_CMD = installFakeClaude();
    const deltas: string[] = [];
    const result = await runClaudeCodeSegment({
      family: 'claude-code', cwd: dir, prompt: 'x'.repeat(64),
      abortSignal: new AbortController().signal,
      onText: d => deltas.push(d),
    });

    expect(deltas).toEqual(['改完了,', '细节见 diff。']);
    expect(result.sessionId).toBe('sess-new');
    expect(result.text).toContain('prompt_bytes=64');
  });

  it('a role with NO configured cwd runs in the per-role scratch dir out of the box', async () => {
    process.env.PULSE_CANVAS_CLAUDE_CODE_CMD = installFakeClaude();
    process.env.PULSE_CANVAS_EXTERNAL_AGENT_HOME = join(dir, 'homes');
    const r = role({ external: { family: 'claude-code' } });

    const text = await runExternalRoleSegment({
      role: r, external: r.external!, chatSessionId: 'chat-1',
      history: [], currentAsk: '聊聊看法', handoffNames: [],
      abortSignal: new AbortController().signal, onText: () => {},
    });

    expect(text).toContain('改完了');
    expect(existsSync(join(dir, 'homes', r.id))).toBe(true);
  });

  it('retries once on a stale resume and persists the fresh session id', async () => {
    process.env.PULSE_CANVAS_CLAUDE_CODE_CMD = installFakeClaude();
    const r = role({ external: { family: 'claude-code', cwd: dir } });
    const resolved = { id: r.id, external: { family: 'claude-code' as const, cwd: dir } };
    await saveExternalSessionId('chat-1', resolved, 'sess-old');

    const text = await runExternalRoleSegment({
      role: r, external: r.external!, chatSessionId: 'chat-1',
      history: [], currentAsk: '修一下', handoffNames: [],
      abortSignal: new AbortController().signal, onText: () => {},
    });

    expect(text).toContain('改完了');
    expect(await getExternalSessionId('chat-1', resolved)).toBe('sess-new');
  });

  it('reports a missing working directory as a config error, not a launch failure', async () => {
    process.env.PULSE_CANVAS_CLAUDE_CODE_CMD = installFakeClaude();
    await expect(runClaudeCodeSegment({
      family: 'claude-code', cwd: join(dir, 'does-not-exist'), prompt: 'p',
      abortSignal: new AbortController().signal, onText: () => {},
    })).rejects.toThrow(/working directory does not exist/);
  });

  it('aborting kills the run and rejects', async () => {
    const hang = join(dir, 'hang-claude');
    writeFileSync(hang, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n');
    chmodSync(hang, 0o755);
    process.env.PULSE_CANVAS_CLAUDE_CODE_CMD = hang;

    const controller = new AbortController();
    const run = runClaudeCodeSegment({
      family: 'claude-code', cwd: dir, prompt: 'p',
      abortSignal: controller.signal, onText: () => {},
    });
    setTimeout(() => controller.abort(), 150);
    await expect(run).rejects.toThrow(/aborted/i);
  });
});

describe('resolveExternalCwd (conversation-time directory chain)', () => {
  it('configured pin wins, and a missing pin is a config error — never silently replaced', async () => {
    expect(await resolveExternalCwd({ roleId: 'r1', configuredCwd: dir, workspaceRootFolder: '/elsewhere' })).toBe(dir);
    await expect(resolveExternalCwd({ roleId: 'r1', configuredCwd: join(dir, 'gone') }))
      .rejects.toThrow(/does not exist/);
  });

  it('falls back to the workspace root, then auto-creates the per-role scratch dir', async () => {
    expect(await resolveExternalCwd({ roleId: 'r1', workspaceRootFolder: dir })).toBe(dir);

    process.env.PULSE_CANVAS_EXTERNAL_AGENT_HOME = join(dir, 'homes');
    const scratch = await resolveExternalCwd({ roleId: 'r1' });
    expect(scratch).toBe(join(dir, 'homes', 'r1'));
    expect(existsSync(scratch)).toBe(true);

    // A stale/nonexistent workspace root degrades to scratch, not an error.
    expect(await resolveExternalCwd({ roleId: 'r1', workspaceRootFolder: join(dir, 'gone') })).toBe(scratch);
  });
});

describe('codex stream parser (both JSONL dialects)', () => {
  it('dialect A: protocol events — deltas, duplicate full message skipped, task_complete result', () => {
    const state = createCodexStreamState();
    const deltas: string[] = [];
    const feed = (obj: unknown) => consumeCodexStreamLine(state, JSON.stringify(obj), d => deltas.push(d));

    feed({ id: '0', msg: { type: 'session_configured', session_id: 'codex-sess-1' } });
    feed({ id: '1', msg: { type: 'agent_message_delta', delta: '改' } });
    feed({ id: '1', msg: { type: 'agent_message_delta', delta: '好了' } });
    feed({ id: '1', msg: { type: 'agent_message', message: '改好了' } });
    feed({ id: '2', msg: { type: 'token_count', total: 42 } });
    feed({ id: '3', msg: { type: 'task_complete', last_agent_message: '改好了' } });

    expect(deltas).toEqual(['改', '好了']);
    expect(state.sessionId).toBe('codex-sess-1');
    expect(state.resultText).toBe('改好了');
  });

  it('dialect B: thread events — thread id, item text, turn.failed error', () => {
    const state = createCodexStreamState();
    const deltas: string[] = [];
    const feed = (obj: unknown) => consumeCodexStreamLine(state, JSON.stringify(obj), d => deltas.push(d));

    feed({ type: 'thread.started', thread_id: 'thread-9' });
    feed({ type: 'item.completed', item: { item_type: 'agent_message', text: '两个风险已修复。' } });
    feed({ type: 'turn.completed', usage: {} });

    expect(deltas).toEqual(['两个风险已修复。']);
    expect(state.sessionId).toBe('thread-9');

    const failing = createCodexStreamState();
    consumeCodexStreamLine(failing, JSON.stringify({ type: 'turn.failed', error: { message: 'sandbox denied' } }), () => {});
    expect(failing.errorMessage).toBe('sandbox denied');
  });

  it('builds exec vs exec-resume argv with the stdin sentinel', () => {
    expect(buildCodexArgs({})).toEqual(['exec', '--json', '--skip-git-repo-check', '-']);
    expect(buildCodexArgs({ sessionId: 's1' })).toEqual(['exec', 'resume', 's1', '--json', '--skip-git-repo-check', '-']);
  });

  it('runs end-to-end against a fake codex binary', async () => {
    const path = join(dir, 'fake-codex');
    writeFileSync(path, [
      '#!/usr/bin/env node',
      "let input = '';",
      "process.stdin.on('data', (c) => { input += c; });",
      "process.stdin.on('end', () => {",
      "  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
      "  out({ type: 'thread.started', thread_id: 'thread-1' });",
      "  out({ type: 'item.completed', item: { item_type: 'agent_message', text: 'mode=' + process.argv[2] + ' bytes=' + input.length } });",
      "  out({ type: 'turn.completed' });",
      '});',
    ].join('\n'));
    chmodSync(path, 0o755);
    process.env.PULSE_CANVAS_CODEX_CMD = path;

    const result = await runCodexSegment({
      family: 'codex', cwd: dir, prompt: 'y'.repeat(32),
      abortSignal: new AbortController().signal, onText: () => {},
    });
    delete process.env.PULSE_CANVAS_CODEX_CMD;

    expect(result.sessionId).toBe('thread-1');
    expect(result.text).toBe('mode=exec bytes=32');
  });
});

describe('handoff target policy', () => {
  it('external roles are never handoff targets; persona roles remain', () => {
    const persona = role({ id: 'r-p', name: '评审员', external: undefined });
    const targets = handoffTargetRoles([role(), persona]);
    expect(targets.map(r => r.id)).toEqual(['r-p']);
  });
});
