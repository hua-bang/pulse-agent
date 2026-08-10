import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileGoalPluginService } from './service.js';
import { runGoalLoop, type GoalConfirm, type GoalRunOnce, type GoalVerify } from './runner.js';

let dir: string;
let service: FileGoalPluginService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goal-runner-test-'));
  service = new FileGoalPluginService({ baseDir: dir, scope: 'scope' });
  await service.initialize();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface MockIos {
  runOnce: ReturnType<typeof vi.fn<GoalRunOnce>>;
  confirm: ReturnType<typeof vi.fn<GoalConfirm>>;
  verify?: ReturnType<typeof vi.fn<GoalVerify>>;
  messages: string[];
  rounds: number[];
}

interface ModelBehavior {
  /** Called by the mocked runOnce with the continuation message; may mutate the goal via `service`. */
  (message: string): { aborted: boolean; result: string } | Promise<{ aborted: boolean; result: string }>;
}

function buildIos(behavior: ModelBehavior = () => ({ aborted: false, result: 'done' })): MockIos {
  const messages: string[] = [];
  const rounds: number[] = [];
  const runOnce = vi.fn<GoalRunOnce>(async (message) => {
    messages.push(message);
    return await behavior(message);
  });
  const confirm = vi.fn<GoalConfirm>(async () => 'y');
  return { runOnce, confirm, messages, rounds };
}

function runLoop(ios: MockIos, overrides: Partial<{ verify: GoalVerify }> = {}) {
  return runGoalLoop({
    service,
    runOnce: ios.runOnce,
    confirm: ios.confirm,
    verify: overrides.verify ?? ios.verify,
    onRoundStart: (round) => ios.rounds.push(round),
    onMessage: () => {},
  });
}

describe('runGoalLoop', () => {
  it('stops immediately when no goal is active', async () => {
    const ios = buildIos();
    const result = await runLoop(ios);
    expect(result).toEqual({ reason: 'no-goal', roundsRun: 0 });
    expect(ios.runOnce).not.toHaveBeenCalled();
  });

  it('auto-continues an active goal until maxRounds is exhausted', async () => {
    await service.setGoal({ objective: 'Fix the bug', maxRounds: 3 });
    // Model never completes: the loop keeps auto-continuing until maxRounds.
    const ios = buildIos();
    const result = await runLoop(ios);

    expect(result.reason).toBe('max-rounds');
    expect(ios.runOnce).toHaveBeenCalledTimes(3);
    expect(ios.rounds).toEqual([1, 2, 3]);
    // Continuation messages carry the Codex-style template + round budget.
    expect(ios.messages[0]).toContain('Continue working toward the active goal');
    expect(ios.messages[0]).toContain('Fix the bug');
    expect(ios.messages[0]).toContain('Rounds used: 1/3');
  });

  it('stops when a continuation round is aborted', async () => {
    await service.setGoal({ objective: 'Long task', maxRounds: 5 });
    const ios = buildIos(() => ({ aborted: true, result: 'Request aborted.' }));
    const result = await runLoop(ios);
    expect(result).toEqual({ reason: 'aborted', roundsRun: 1 });
  });

  it('asks the user after completion and ends on confirm', async () => {
    await service.setGoal({ objective: 'Ship it' });
    await service.completeGoal({ summary: 'All tests pass' });

    const ios = buildIos();
    const result = await runLoop(ios);

    expect(result).toEqual({ reason: 'user-confirmed', roundsRun: 0 });
    expect(ios.confirm).toHaveBeenCalledTimes(1);
    expect(ios.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Confirm?'),
      expect.stringContaining('All tests pass'),
    );
    // Goal stays completed (user confirmed).
    expect((await service.getGoal())?.status).toBe('completed');
  });

  it('clears the goal when the user answers stop at the confirmation prompt', async () => {
    await service.setGoal({ objective: 'Ship it' });
    await service.completeGoal({ summary: 'Done' });

    const ios = buildIos();
    ios.confirm.mockResolvedValue('stop');
    const result = await runLoop(ios);

    expect(result.reason).toBe('cleared');
    expect(await service.getGoal()).toBeNull();
  });

  it('re-activates and continues when the user gives feedback after completion, then completes on the next round', async () => {
    await service.setGoal({ objective: 'Ship it', maxRounds: 3 });
    await service.completeGoal({ summary: 'Done' });

    // Round 1 (after feedback): model works and then declares completion again.
    const ios = buildIos(async () => {
      await service.completeGoal({ summary: 'Done, now with docs' });
      return { aborted: false, result: 'updated docs' };
    });
    // First confirmation: user gives feedback. Second: user confirms.
    ios.confirm
      .mockResolvedValueOnce('also update the docs')
      .mockResolvedValueOnce('y');

    const result = await runLoop(ios);

    expect(result.reason).toBe('user-confirmed');
    expect(ios.runOnce).toHaveBeenCalledTimes(1);
    expect(ios.messages[0]).toContain('User feedback: also update the docs');
    // Confirm was asked twice: once after the initial completion (feedback),
    // once after the second completion (y).
    expect(ios.confirm).toHaveBeenCalledTimes(2);
    expect((await service.getGoal())?.status).toBe('completed');
  });

  it('re-activates and continues when verification fails, feeding the failure back', async () => {
    await service.setGoal({ objective: 'Green tests', verifyCommand: 'exit 1', maxRounds: 2 });
    await service.completeGoal({ summary: 'Looks done' });

    const verify = vi.fn<GoalVerify>(async () => ({ ok: false, output: 'boom' }));
    const ios = buildIos();
    const result = await runLoop(ios, { verify });

    expect(result.reason).toBe('max-rounds'); // verify failed → re-armed active → ran out of rounds
    expect(verify).toHaveBeenCalledWith('exit 1');
    // rearm consumed round 1 (recordRound during rearm); the loop then ran one
    // continuation round (round 2) before hitting maxRounds=2.
    expect(ios.runOnce).toHaveBeenCalledTimes(1);
    // The failure output rides the continuation message as Last progress.
    expect(ios.messages[0]).toContain('Verification failed');
    expect(ios.messages[0]).toContain('boom');
    expect((await service.getGoal())?.status).toBe('active');
    expect((await service.getGoal())?.roundsUsed).toBe(2);
    // The user is NOT asked when verification failed — the loop just continues.
    expect(ios.confirm).not.toHaveBeenCalled();
  });

  it('asks the user when verification passes', async () => {
    await service.setGoal({ objective: 'Green tests', verifyCommand: 'true' });
    await service.completeGoal({ summary: 'Verified done' });

    const verify = vi.fn<GoalVerify>(async () => ({ ok: true, output: 'ok' }));
    const ios = buildIos();
    const result = await runLoop(ios, { verify });

    expect(result.reason).toBe('user-confirmed');
    expect(verify).toHaveBeenCalledWith('true');
    expect(ios.confirm).toHaveBeenCalledTimes(1);
  });

  it('stops cleanly when the confirmation prompt is interrupted', async () => {
    await service.setGoal({ objective: 'Ship it' });
    await service.completeGoal({ summary: 'Done' });

    const ios = buildIos();
    ios.confirm.mockRejectedValue(new Error('Interrupted'));
    const result = await runLoop(ios);

    expect(result).toEqual({ reason: 'aborted', roundsRun: 0 });
  });
});
