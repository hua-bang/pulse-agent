import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

// Pin `os.homedir()` to a temp dir BEFORE the modules under test load it so
// the session store reads/writes under a per-test sandbox rather than the
// developer's real ~/.pulse-coder/canvas tree. Mirrors knowledge-tools.test.ts.
const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}session-tools-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

import { createSessionTools } from '../tools/sessions';
import type { CanvasAgentMessage, CanvasAgentSession } from '../types';

const CANVAS_DIR = join(sandboxHome, '.pulse-coder', 'canvas');
const DAY_MS = 86_400_000;

function msg(role: 'user' | 'assistant', content: string, timestamp: number, toolNames: string[] = []): CanvasAgentMessage {
  return {
    role,
    content,
    timestamp,
    ...(toolNames.length
      ? { toolCalls: toolNames.map((name, i) => ({ id: i + 1, name, status: 'done' as const })) }
      : {}),
  };
}

function session(workspaceId: string, sessionId: string, startedAtMs: number, messages: CanvasAgentMessage[]): CanvasAgentSession {
  return {
    sessionId,
    workspaceId,
    startedAt: new Date(startedAtMs).toISOString(),
    messages,
  };
}

async function writeManifest(payload: unknown): Promise<void> {
  await fs.writeFile(join(CANVAS_DIR, '__workspaces__.json'), JSON.stringify(payload), 'utf-8');
}

async function writeCurrent(workspaceId: string, data: CanvasAgentSession): Promise<void> {
  const dir = join(CANVAS_DIR, workspaceId, 'agent-sessions');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'current.json'), JSON.stringify(data), 'utf-8');
}

async function writeArchived(workspaceId: string, data: CanvasAgentSession): Promise<void> {
  const dir = join(CANVAS_DIR, workspaceId, 'agent-sessions', 'archive');
  await fs.mkdir(dir, { recursive: true });
  const date = data.startedAt.slice(0, 10);
  await fs.writeFile(join(dir, `${date}-${Date.parse(data.startedAt)}.json`), JSON.stringify(data), 'utf-8');
}

const now = Date.now();

async function seed(): Promise<void> {
  await writeManifest({
    activeId: 'ws-research',
    workspaces: [
      { id: 'ws-research', name: '调研' },
      { id: 'ws-weekly', name: '周报' },
    ],
  });

  // ws-research: a current session (today) + an archived one (10 days ago).
  await writeCurrent('ws-research', session('ws-research', 's-research-now', now - 3_600_000, [
    msg('user', '帮我研究一下 RAG 检索增强的方案', now - 3_600_000),
    msg('assistant', 'RAG 方案有以下几个要点……', now - 3_500_000, ['canvas_search_nodes']),
  ]));
  await writeArchived('ws-research', session('ws-research', 's-research-old', now - 10 * DAY_MS, [
    msg('user', 'deploy pipeline keeps failing', now - 10 * DAY_MS),
    msg('assistant', 'The deploy failure is caused by a missing env var.', now - 10 * DAY_MS + 60_000),
  ]));

  // ws-weekly: one archived session from yesterday.
  await writeArchived('ws-weekly', session('ws-weekly', 's-weekly-1', now - DAY_MS, [
    msg('user', '写一下本周周报', now - DAY_MS),
    msg('assistant', '本周完成了 RAG 调研和部署修复。', now - DAY_MS + 30_000, ['canvas_read_node', 'canvas_update_node']),
  ]));

  // Global chat current session (today).
  await writeCurrent('__global_chat__', session('__global_chat__', 's-global-1', now - 7_200_000, [
    msg('user', '全局问题：RAG 和微调怎么选？', now - 7_200_000),
    msg('assistant', '取决于数据量和时效性……', now - 7_100_000),
  ]));
}

beforeEach(async () => {
  await fs.mkdir(CANVAS_DIR, { recursive: true });
  await seed();
});

afterEach(async () => {
  await fs.rm(join(sandboxHome, '.pulse-coder'), { recursive: true, force: true });
});

describe('session_search', () => {
  it('finds sessions across workspaces and global chat with snippets and workspace names', async () => {
    const tools = createSessionTools();
    const out = JSON.parse(await tools.session_search.execute({ query: 'RAG' }));

    expect(out.ok).toBe(true);
    const ids = out.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).toContain('s-research-now');
    expect(ids).toContain('s-weekly-1');
    expect(ids).toContain('s-global-1');
    expect(ids).not.toContain('s-research-old');

    const research = out.sessions.find((s: { sessionId: string }) => s.sessionId === 's-research-now');
    expect(research.workspaceName).toBe('调研');
    expect(research.isCurrent).toBe(true);
    expect(research.matchCount).toBe(2);
    expect(research.snippets[0].snippet).toContain('RAG');

    const global = out.sessions.find((s: { sessionId: string }) => s.sessionId === 's-global-1');
    expect(global.workspaceName).toBe('Global Chat');
  });

  it('restricts to one workspace when workspaceId is given', async () => {
    const tools = createSessionTools();
    const out = JSON.parse(await tools.session_search.execute({ query: 'rag', workspaceId: 'ws-weekly' }));
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].sessionId).toBe('s-weekly-1');
  });

  it('filters by message role', async () => {
    const tools = createSessionTools();
    // "deploy" appears in both roles of s-research-old; restrict to user.
    const out = JSON.parse(await tools.session_search.execute({ query: 'deploy', role: 'user' }));
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].matchCount).toBe(1);
    expect(out.sessions[0].snippets[0].role).toBe('user');
  });

  it('returns an empty result for no matches', async () => {
    const tools = createSessionTools();
    const out = JSON.parse(await tools.session_search.execute({ query: 'nonexistent-topic-xyz' }));
    expect(out.ok).toBe(true);
    expect(out.total).toBe(0);
    expect(out.sessions).toHaveLength(0);
  });
});

describe('session_summary', () => {
  it('returns the transcript excerpt for an explicit sessionId', async () => {
    const tools = createSessionTools();
    const out = JSON.parse(await tools.session_summary.execute({ sessionId: 's-weekly-1' }));

    expect(out.ok).toBe(true);
    expect(out.matchedSessions).toBe(1);
    const s = out.sessions[0];
    expect(s.workspaceName).toBe('周报');
    expect(s.excerpt).toHaveLength(2);
    expect(s.excerpt[0]).toMatch(/^user: 写一下本周周报/);
    expect(s.excerpt[1]).toMatch(/^assistant: 本周完成了/);
  });

  it('errors on an unknown sessionId', async () => {
    const tools = createSessionTools();
    const out = await tools.session_summary.execute({ sessionId: 'no-such-session' });
    expect(out).toContain('Error: session not found');
  });

  it('selects sessions by recent-days window and excludes older ones', async () => {
    const tools = createSessionTools();
    const out = JSON.parse(await tools.session_summary.execute({ days: 3 }));

    expect(out.ok).toBe(true);
    const ids = out.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).toContain('s-research-now');
    expect(ids).toContain('s-weekly-1');
    expect(ids).toContain('s-global-1');
    expect(ids).not.toContain('s-research-old');
    expect(out.since).toBeDefined();
    expect(out.until).toBeDefined();
  });

  it('respects role filters and reports tools used', async () => {
    const tools = createSessionTools();
    const out = JSON.parse(await tools.session_summary.execute({
      sessionId: 's-weekly-1',
      includeAssistantMessages: false,
      includeToolCalls: true,
    }));

    const s = out.sessions[0];
    expect(s.excerpt).toHaveLength(1);
    expect(s.excerpt[0]).toMatch(/^user:/);
    expect(s.toolsUsed).toEqual(expect.arrayContaining(['canvas_read_node', 'canvas_update_node']));
  });

  it('caps excerpt length with maxMessagesPerSession, keeping the newest', async () => {
    const tools = createSessionTools();
    const out = JSON.parse(await tools.session_summary.execute({
      sessionId: 's-research-now',
      maxMessagesPerSession: 5,
    }));
    // Session only has 2 messages; verify the field is honored structurally.
    expect(out.sessions[0].excerptMessageCount).toBe(2);

    const capped = JSON.parse(await tools.session_summary.execute({
      sessionId: 's-research-now',
      maxMessagesPerSession: 5,
      includeUserMessages: false,
    }));
    expect(capped.sessions[0].excerpt.every((line: string) => line.startsWith('assistant:'))).toBe(true);
  });
});
