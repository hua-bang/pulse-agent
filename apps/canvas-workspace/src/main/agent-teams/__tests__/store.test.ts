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

  it('caps per-team event history and archives the trimmed entries', async () => {
    const store = new CanvasAgentTeamStore('ws-3');

    for (let index = 0; index < 450; index += 1) {
      await store.appendEvent({
        id: `event-${index}`,
        teamId: 'team-3',
        type: 'task_created',
        timestamp: 1000 + index,
        actor: 'runtime',
        payload: {},
      });
    }
    // Another team's history is untouched by team-3's trimming.
    await store.appendEvent({
      id: 'other-event',
      teamId: 'team-other',
      type: 'task_created',
      timestamp: 1,
      actor: 'runtime',
      payload: {},
    });

    const events = await store.listEvents('team-3');
    expect(events).toHaveLength(400);
    // The oldest 50 were trimmed; the newest survive.
    expect(events[0].id).toBe('event-50');
    expect(events.at(-1)?.id).toBe('event-449');
    expect(await store.listEvents('team-other')).toHaveLength(1);

    // Trimmed entries are preserved in the JSONL archive for later reporting.
    const archivePath = join(mockState.root, 'ws-3', 'agent-teams', 'archive', 'team-3.events.jsonl');
    const lines = (await fs.readFile(archivePath, 'utf-8')).trim().split('\n');
    expect(lines).toHaveLength(50);
    expect(JSON.parse(lines[0]).id).toBe('event-0');
    expect(JSON.parse(lines.at(-1)!).id).toBe('event-49');

    // Deleting the team removes its archive too.
    await store.deleteTeam('team-3');
    await expect(fs.access(archivePath)).rejects.toThrow();
  });
});
