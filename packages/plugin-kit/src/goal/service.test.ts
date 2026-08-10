import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';

import { FileGoalPluginService } from './service.js';

let dir: string;
let service: FileGoalPluginService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goal-test-'));
  service = new FileGoalPluginService({ baseDir: dir, scope: 'test-scope' });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileGoalPluginService', () => {
  it('starts with no goal', async () => {
    const snapshot = await service.snapshot();
    expect(snapshot.status).toBe('none');
  });

  it('sets an active goal with defaults', async () => {
    const goal = await service.setGoal({ objective: 'Fix all failing tests' });
    expect(goal.status).toBe('active');
    expect(goal.objective).toBe('Fix all failing tests');
    expect(goal.roundsUsed).toBe(0);
    expect(goal.verifyCommand).toBeUndefined();
    expect(goal.maxRounds).toBeUndefined();
  });

  it('setGoal trims objective and persists to disk', async () => {
    await service.setGoal({ objective: '  Do the thing  ', verifyCommand: 'pnpm test', maxRounds: 3 });

    const raw = await readFile(service.storagePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.goal.objective).toBe('Do the thing');
    expect(parsed.goal.verifyCommand).toBe('pnpm test');
    expect(parsed.goal.maxRounds).toBe(3);
  });

  it('replaces a previous goal on setGoal', async () => {
    const first = await service.setGoal({ objective: 'First goal' });
    const second = await service.setGoal({ objective: 'Second goal' });
    expect(second.id).not.toBe(first.id);
    expect((await service.getGoal())?.objective).toBe('Second goal');
  });

  it('recordRound increments the counter only while active', async () => {
    await service.setGoal({ objective: 'Long task' });
    await service.recordRound();
    await service.recordRound();
    expect((await service.getGoal())?.roundsUsed).toBe(2);

    await service.completeGoal({ summary: 'Done' });
    await service.recordRound();
    expect((await service.getGoal())?.roundsUsed).toBe(2);
  });

  it('setProgress records a snapshot', async () => {
    await service.setGoal({ objective: 'Long task' });
    await service.setProgress('Fixed 3 of 5 tests');
    expect((await service.getGoal())?.lastProgress).toBe('Fixed 3 of 5 tests');
  });

  it('completeGoal marks completed with summary and evidence', async () => {
    await service.setGoal({ objective: 'Ship the feature' });
    const completed = await service.completeGoal({
      summary: 'Feature shipped',
      evidence: ['pnpm test passed (42)', 'typecheck clean'],
    });
    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).toBeTypeOf('number');
    expect(completed?.completedSummary).toBe('Feature shipped');
    expect(completed?.lastProgress).toContain('typecheck clean');
  });

  it('completeGoal is a no-op when no active goal exists', async () => {
    const result = await service.completeGoal({ summary: 'Nothing to do' });
    expect(result).toBeNull();
  });

  it('clearGoal removes the goal and returns true only when one existed', async () => {
    expect(await service.clearGoal()).toBe(false);

    await service.setGoal({ objective: 'To be cleared' });
    expect(await service.clearGoal()).toBe(true);
    expect((await service.getGoal())).toBeNull();
  });

  it('snapshot exposes the full state', async () => {
    await service.setGoal({ objective: 'Visible goal', maxRounds: 5 });
    await service.recordRound();

    const snapshot = await service.snapshot();
    expect(snapshot.status).toBe('active');
    expect(snapshot.objective).toBe('Visible goal');
    expect(snapshot.maxRounds).toBe(5);
    expect(snapshot.roundsUsed).toBe(1);
    expect(snapshot.storagePath).toContain('test-scope.json');
  });

  it('scope normalization sanitizes scope names', async () => {
    const weird = new FileGoalPluginService({ baseDir: dir, scope: 'session abc/../x' });
    expect(weird.scope).not.toContain('/');
    expect(weird.scope).not.toContain('..');
    expect(weird.scope).not.toContain(' ');
    // The file name comes from the sanitized scope, never from the raw input.
    expect(basename(weird.storagePath)).toBe(`${weird.scope}.json`);
  });

  it('survives a reload from disk', async () => {
    await service.setGoal({ objective: 'Persistent goal' });

    const reloaded = new FileGoalPluginService({ baseDir: dir, scope: 'test-scope' });
    await reloaded.initialize();
    expect((await reloaded.getGoal())?.objective).toBe('Persistent goal');
  });
});
