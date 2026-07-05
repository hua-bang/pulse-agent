import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionStore } from '../session-store';
import type { CanvasAgentMessage } from '../types';

const makeMessage = (index: number): CanvasAgentMessage => ({
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `message ${index}`,
  timestamp: Date.now(),
});

describe('SessionStore', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `session-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.PULSE_CANVAS_SESSION_STORE_DIR = root;
  });

  afterEach(async () => {
    delete process.env.PULSE_CANVAS_SESSION_STORE_DIR;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('persists many concurrent addMessage calls without racing the temp-file rename', async () => {
    const store = new SessionStore('ws-1');
    await store.startSession();

    // Fire every addMessage synchronously back-to-back (mirrors the old
    // loadCrossWorkspaceSession loop) — without the persistQueue,
    // overlapping writeFile calls to current.json raced and the final file
    // could end up with an earlier (smaller) snapshot than the last call.
    const messages = Array.from({ length: 60 }, (_, i) => makeMessage(i));
    for (const message of messages) {
      store.addMessage(message);
    }

    // Wait for the queued chain to drain by issuing one more persist-backed
    // call and reading the state back from a fresh store instance.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const reloaded = new SessionStore('ws-1');
    const session = await reloaded.loadSession(store.getCurrentSession()!.sessionId);
    expect(session?.messages.map((m) => m.content)).toEqual(messages.map((m) => m.content));

    const sessionsDir = join(root, 'ws-1', 'agent-sessions');
    const entries = await fs.readdir(sessionsDir);
    expect(entries.filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('setMessages persists once instead of once per message', async () => {
    const store = new SessionStore('ws-2');
    await store.startSession();
    const messages = Array.from({ length: 10 }, (_, i) => makeMessage(i));

    store.setMessages(messages);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(store.getMessages().map((m) => m.content)).toEqual(messages.map((m) => m.content));
    const reloaded = new SessionStore('ws-2');
    const session = await reloaded.loadSession(store.getCurrentSession()!.sessionId);
    expect(session?.messages.map((m) => m.content)).toEqual(messages.map((m) => m.content));
  });

  it('archiveCurrentIfExists waits for in-flight writes before archiving', async () => {
    const store = new SessionStore('ws-3');
    await store.startSession();
    const firstSessionId = store.getCurrentSession()!.sessionId;

    // Fire a message add (fire-and-forget persist queued) and immediately
    // start a new session — startSession's archiveCurrentIfExists must wait
    // for that queued write, or the just-started fresh session's file could
    // be clobbered by the outgoing session's late write.
    store.addMessage(makeMessage(0));
    await store.startSession();
    const secondSessionId = store.getCurrentSession()!.sessionId;
    expect(secondSessionId).not.toBe(firstSessionId);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const reloaded = new SessionStore('ws-3');
    const current = await reloaded.loadSession(secondSessionId);
    expect(current?.sessionId).toBe(secondSessionId);
    expect(current?.messages).toEqual([]);

    const archived = await reloaded.listArchivedSessions();
    expect(archived.some((s) => s.sessionId === firstSessionId)).toBe(true);
  });
});
