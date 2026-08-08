import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractMessageText, SessionManager } from './session.js';

describe('extractMessageText', () => {
  it('returns plain string content as-is', () => {
    expect(extractMessageText('hello')).toBe('hello');
  });

  it('joins text parts and skips tool parts in structured content', () => {
    expect(extractMessageText([
      { type: 'text', text: 'part one' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'bash', input: { command: 'ls' } },
      { type: 'text', text: 'part two' },
    ])).toBe('part one part two');
  });

  it('returns empty string for tool-only or unknown content', () => {
    expect(extractMessageText([{ type: 'tool-result', toolCallId: 'c1', output: 'x' }])).toBe('');
    expect(extractMessageText({ foo: 'bar' })).toBe('');
    expect(extractMessageText(null)).toBe('');
  });

  it('reads text-bearing object content', () => {
    expect(extractMessageText({ type: 'text', text: 'obj text' })).toBe('obj text');
  });
});

describe('SessionManager cwd scoping', () => {
  let dir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-sessions-'));
    manager = new SessionManager();
    // Point the manager at a temp dir instead of the real ~/.pulse-coder.
    (manager as unknown as { sessionsDir: string }).sessionsDir = dir;
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('records the creating cwd and filters listings by it', async () => {
    await manager.createSession('project A', '/work/a');
    await manager.createSession('project B', '/work/b');

    const all = await manager.listSessions({});
    expect(all).toHaveLength(2);

    const scoped = await manager.listSessions({ cwd: '/work/a' });
    expect(scoped.map(session => session.title)).toEqual(['project A']);
    expect(scoped[0].cwd).toBe('/work/a');
  });

  it('always includes legacy sessions that predate the cwd field', async () => {
    const legacy = await manager.createSession('legacy', '/work/a');
    delete legacy.metadata.cwd;
    await manager.saveSession(legacy);

    const scoped = await manager.listSessions({ cwd: '/somewhere/else' });
    expect(scoped.map(session => session.title)).toEqual(['legacy']);
  });

  it('writes sessions atomically, leaving no temp files behind', async () => {
    // A plain writeFile truncates before writing, so a process killed mid-save
    // leaves the conversation empty or half-written. saveSession writes to a
    // temp file and renames over the target instead.
    const session = await manager.createSession('atomic', '/work/a');
    session.messages.push({ role: 'user', content: 'hello', timestamp: Date.now() } as never);
    await manager.saveSession(session);

    const entries = await fs.readdir(dir);
    expect(entries).toEqual([`${session.id}.json`]);
    expect(entries.some(entry => entry.endsWith('.tmp'))).toBe(false);

    const reloaded = await manager.loadSession(session.id);
    expect(reloaded?.messages).toHaveLength(1);
  });

  it('scopes search to the given cwd', async () => {
    await manager.createSession('alpha report', '/work/a');
    await manager.createSession('alpha notes', '/work/b');

    expect(await manager.searchSessions('alpha')).toHaveLength(2);
    expect((await manager.searchSessions('alpha', '/work/b')).map(s => s.title)).toEqual(['alpha notes']);
  });
});
