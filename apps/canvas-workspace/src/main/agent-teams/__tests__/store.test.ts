import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockState = vi.hoisted(() => ({ root: '' }));

vi.mock('../../canvas/storage', () => ({
  get STORE_DIR() {
    return mockState.root;
  },
}));

import { CanvasAgentTeamStore } from '../store';
import type { TeamTaskRecord } from 'pulse-coder-agent-teams/runtime';

const makeTask = (id: string): TeamTaskRecord => ({
  id,
  teamId: 'team-1',
  title: `Task ${id}`,
  description: 'desc',
  status: 'todo',
  deps: [],
  createdBy: 'runtime',
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('CanvasAgentTeamStore', () => {
  beforeEach(() => {
    mockState.root = join(tmpdir(), `canvas-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    await fs.rm(mockState.root, { recursive: true, force: true });
  });

  it('persists many concurrent writes without racing the temp-file rename', async () => {
    const store = new CanvasAgentTeamStore('ws-1');
    const ids = Array.from({ length: 60 }, (_, index) => `task-${index}`);

    // Fire every write concurrently. With a single fixed temp filename and no
    // write serialization, two overlapping persists raced and one rename threw
    // `ENOENT ... rename state.json.tmp -> state.json`, dropping updates.
    await Promise.all(ids.map((id) => store.saveTask(makeTask(id))));

    const tasks = await store.listTasks('team-1');
    expect(tasks.map((task) => task.id).sort()).toEqual([...ids].sort());

    // A fresh store reads the same committed state back from disk.
    const reloaded = new CanvasAgentTeamStore('ws-1');
    expect((await reloaded.listTasks('team-1')).map((task) => task.id).sort()).toEqual([...ids].sort());

    // No orphaned temp files are left behind.
    const dir = join(mockState.root, 'ws-1', 'agent-teams');
    const entries = await fs.readdir(dir);
    expect(entries.filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('keeps the final on-disk state valid under interleaved record types', async () => {
    const store = new CanvasAgentTeamStore('ws-2');

    await Promise.all([
      store.saveTeam({
        id: 'team-2',
        name: 'Concurrent',
        goal: 'Stay consistent',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      ...Array.from({ length: 20 }, (_, index) =>
        store.appendEvent({
          id: `event-${index}`,
          teamId: 'team-2',
          type: 'task_created',
          timestamp: Date.now() + index,
          actor: 'runtime',
          payload: {},
        }),
      ),
      ...Array.from({ length: 20 }, (_, index) => store.saveTask(makeTask(`t-${index}`))),
    ]);

    const statePath = join(mockState.root, 'ws-2', 'agent-teams', 'state.json');
    const parsed = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expect(parsed.teams).toHaveLength(1);
    expect(parsed.events).toHaveLength(20);
    expect(parsed.tasks).toHaveLength(20);
  });

  it('caps per-team event and message logs at a rolling window', async () => {
    const store = new CanvasAgentTeamStore('ws-3', { maxEventsPerTeam: 6, maxMessagesPerTeam: 4 });

    for (let index = 0; index < 10; index += 1) {
      await store.appendEvent({
        id: `event-${index}`,
        teamId: 'team-3',
        type: 'task_created',
        timestamp: index,
        actor: 'runtime',
        payload: {},
      });
    }
    // Another team's log is untouched by team-3 overflow.
    await store.appendEvent({
      id: 'other-event',
      teamId: 'team-other',
      type: 'task_created',
      timestamp: 0,
      actor: 'runtime',
      payload: {},
    });

    const events = await store.listEvents('team-3');
    expect(events).toHaveLength(6);
    // Oldest entries were dropped; the newest survive.
    expect(events[0].id).toBe('event-4');
    expect(events.at(-1)?.id).toBe('event-9');
    expect(await store.listEvents('team-other')).toHaveLength(1);

    for (let index = 0; index < 7; index += 1) {
      await store.appendMessage({
        id: `message-${index}`,
        teamId: 'team-3',
        from: 'runtime',
        to: 'lead',
        type: 'status_update',
        content: `update ${index}`,
        createdAt: index,
      });
    }
    const messages = await store.listMessages('team-3');
    expect(messages).toHaveLength(4);
    expect(messages[0].id).toBe('message-3');
    expect(messages.at(-1)?.id).toBe('message-6');

    // The trimmed window is what lands on disk.
    const reloaded = new CanvasAgentTeamStore('ws-3');
    expect(await reloaded.listEvents('team-3')).toHaveLength(6);
    expect(await reloaded.listMessages('team-3')).toHaveLength(4);
  });
});
