import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Context } from 'pulse-coder-engine';
import { SessionCommands } from './session-commands.js';
import { SessionManager, type Session } from './session.js';

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  title: 'Test Session',
  createdAt: 1,
  updatedAt: 1,
  messages: [],
  metadata: {
    totalMessages: 0,
  },
  ...overrides,
});

describe('SessionCommands', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a session and persists generated task list id for legacy metadata', async () => {
    const session = makeSession({ id: 'legacy-session' });

    vi.spyOn(SessionManager.prototype, 'createSession').mockResolvedValue(session);
    const saveSpy = vi.spyOn(SessionManager.prototype, 'saveSession').mockResolvedValue();

    const commands = new SessionCommands();
    const createdId = await commands.createSession('Legacy Session');

    expect(createdId).toBe('legacy-session');
    expect(commands.getCurrentSessionId()).toBe('legacy-session');
    expect(commands.getCurrentTaskListId()).toBe('session-legacy-session');
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'legacy-session',
        metadata: expect.objectContaining({ taskListId: 'session-legacy-session' }),
      }),
    );
  });

  it('returns false when resuming a non-existing session', async () => {
    vi.spyOn(SessionManager.prototype, 'loadSession').mockResolvedValue(null);
    vi.spyOn(SessionManager.prototype, 'listSessions').mockResolvedValue([]);

    const commands = new SessionCommands();
    const resumed = await commands.resumeSession('missing');

    expect(resumed).toBe(false);
    expect(commands.getCurrentSessionId()).toBeNull();
    expect(commands.getCurrentTaskListId()).toBeNull();
  });

  it('resumes by 1-based index from the session listing', async () => {
    const target = makeSession({ id: 'recent-session' });
    vi.spyOn(SessionManager.prototype, 'loadSession').mockImplementation(async id => (id === 'recent-session' ? target : null));
    vi.spyOn(SessionManager.prototype, 'listSessions').mockResolvedValue([
      { id: 'recent-session', title: 'A', createdAt: 1, updatedAt: 2, messageCount: 0, preview: '' },
      { id: 'older-session', title: 'B', createdAt: 1, updatedAt: 1, messageCount: 0, preview: '' },
    ]);
    vi.spyOn(SessionManager.prototype, 'saveSession').mockResolvedValue();

    const commands = new SessionCommands();
    expect(await commands.resumeSession('1')).toBe(true);
    expect(commands.getCurrentSessionId()).toBe('recent-session');
  });

  it('resumes by unique id prefix and rejects ambiguous prefixes', async () => {
    const target = makeSession({ id: 'abcd-unique' });
    vi.spyOn(SessionManager.prototype, 'loadSession').mockImplementation(async id => (id === 'abcd-unique' ? target : null));
    const listSpy = vi.spyOn(SessionManager.prototype, 'listSessions').mockResolvedValue([
      { id: 'abcd-unique', title: 'A', createdAt: 1, updatedAt: 2, messageCount: 0, preview: '' },
    ]);
    vi.spyOn(SessionManager.prototype, 'saveSession').mockResolvedValue();

    const commands = new SessionCommands();
    expect(await commands.resumeSession('abcd')).toBe(true);
    expect(commands.getCurrentSessionId()).toBe('abcd-unique');

    listSpy.mockResolvedValue([
      { id: 'abcd-one', title: 'A', createdAt: 1, updatedAt: 2, messageCount: 0, preview: '' },
      { id: 'abcd-two', title: 'B', createdAt: 1, updatedAt: 1, messageCount: 0, preview: '' },
    ]);
    expect(await commands.resumeSession('abcd')).toBe(false);
  });

  it('auto-titles default-titled sessions from the first message, keeping explicit titles', async () => {
    const defaultTitled = makeSession({ id: 'auto-1', title: 'Session 8/6/2026, 10:00:00 AM' });
    vi.spyOn(SessionManager.prototype, 'createSession').mockResolvedValue(defaultTitled);
    vi.spyOn(SessionManager.prototype, 'loadSession').mockResolvedValue(defaultTitled);
    vi.spyOn(SessionManager.prototype, 'saveSession').mockResolvedValue();
    const renameSpy = vi.spyOn(SessionManager.prototype, 'updateSessionTitle').mockResolvedValue(true);

    const commands = new SessionCommands();
    await commands.createSession();
    await commands.maybeAutoTitle('  帮我看下   cli 包的测试都过不过  ');
    expect(renameSpy).toHaveBeenCalledWith('auto-1', '帮我看下 cli 包的测试都过不过');

    renameSpy.mockClear();
    vi.spyOn(SessionManager.prototype, 'loadSession').mockResolvedValue(makeSession({ id: 'auto-1', title: 'My Custom Title' }));
    await commands.maybeAutoTitle('another message');
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it('resumes the most recent session with resumeLatest', async () => {
    const target = makeSession({ id: 'latest-session' });
    vi.spyOn(SessionManager.prototype, 'loadSession').mockImplementation(async id => (id === 'latest-session' ? target : null));
    vi.spyOn(SessionManager.prototype, 'listSessions').mockResolvedValue([
      { id: 'latest-session', title: 'A', createdAt: 1, updatedAt: 2, messageCount: 0, preview: '' },
    ]);
    vi.spyOn(SessionManager.prototype, 'saveSession').mockResolvedValue();

    const commands = new SessionCommands();
    expect(await commands.resumeLatest()).toBe(true);
    expect(commands.getCurrentSessionId()).toBe('latest-session');
  });

  it('saves context messages back to current session with task list binding', async () => {
    const created = makeSession({
      id: 'active-session',
      metadata: { totalMessages: 0, taskListId: 'task-list-active' },
    });

    const loaded = makeSession({
      id: 'active-session',
      metadata: { totalMessages: 0 },
    });

    vi.spyOn(SessionManager.prototype, 'createSession').mockResolvedValue(created);
    vi.spyOn(SessionManager.prototype, 'loadSession').mockResolvedValue(loaded);
    const saveSpy = vi.spyOn(SessionManager.prototype, 'saveSession').mockResolvedValue();

    const commands = new SessionCommands();
    await commands.createSession('Active Session');

    const context: Context = {
      messages: [{ role: 'user', content: 'hello session' }],
    };

    await commands.saveContext(context);

    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'active-session',
        metadata: expect.objectContaining({ taskListId: 'task-list-active' }),
        messages: [
          expect.objectContaining({
            role: 'user',
            content: 'hello session',
            timestamp: expect.any(Number),
          }),
        ],
      }),
    );
  });

  it('records the active model at save and exposes the loaded session model', async () => {
    const session = makeSession({ id: 's-model', metadata: { totalMessages: 0 } });
    vi.spyOn(SessionManager.prototype, 'createSession').mockResolvedValue(session);
    vi.spyOn(SessionManager.prototype, 'loadSession').mockResolvedValue(session);
    const saveSpy = vi.spyOn(SessionManager.prototype, 'saveSession').mockResolvedValue();

    let activeSpec: string | null = 'acme:test-model-b';
    const commands = new SessionCommands();
    commands.setModelSpecProvider(() => activeSpec);
    await commands.createSession('Model Session');

    const context: Context = { messages: [] };
    await commands.saveContext(context);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ model: 'acme:test-model-b' }) }),
    );

    // Back on the env default: the stale spec must not outlive the reset.
    activeSpec = null;
    await commands.saveContext(context);
    const lastSaved = saveSpy.mock.calls[saveSpy.mock.calls.length - 1][0] as Session;
    expect(lastSaved.metadata.model).toBeUndefined();

    // Resuming surfaces whatever the session recorded — null for legacy ones.
    await commands.loadContext(context);
    expect(commands.getLoadedModelSpec()).toBeNull();

    vi.spyOn(SessionManager.prototype, 'loadSession').mockResolvedValue(
      makeSession({ id: 's-model', metadata: { totalMessages: 0, model: 'acme:test-model-b' } }),
    );
    await commands.loadContext(context);
    expect(commands.getLoadedModelSpec()).toBe('acme:test-model-b');
  });

  it('clears current session/task list when deleting active session', async () => {
    const current = makeSession({
      id: 'to-delete',
      metadata: { totalMessages: 0, taskListId: 'task-list-delete' },
    });

    vi.spyOn(SessionManager.prototype, 'createSession').mockResolvedValue(current);
    vi.spyOn(SessionManager.prototype, 'deleteSession').mockResolvedValue(true);

    const commands = new SessionCommands();
    await commands.createSession('To Delete');

    const success = await commands.deleteSession('to-delete');

    expect(success).toBe(true);
    expect(commands.getCurrentSessionId()).toBeNull();
    expect(commands.getCurrentTaskListId()).toBeNull();
  });
});
