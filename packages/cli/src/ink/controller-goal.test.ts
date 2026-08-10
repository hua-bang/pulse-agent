import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileGoalPluginService } from 'pulse-coder-plugin-kit/goal';
import { decideGoalContinuation } from './controller-goal.js';

interface MockUi {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

interface MockController {
  ui: MockUi;
  inputManager: { requestInput: ReturnType<typeof vi.fn> };
}

function buildMockController(): MockController {
  return {
    ui: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
    inputManager: { requestInput: vi.fn() },
  };
}

let dir: string;
let service: FileGoalPluginService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goal-cli-test-'));
  service = new FileGoalPluginService({ baseDir: dir, scope: 'scope' });
  await service.initialize();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('decideGoalContinuation', () => {
  it('stops when no goal is active', async () => {
    const controller = buildMockController();
    const decision = await decideGoalContinuation(controller as never, service);
    expect(decision).toEqual({ action: 'stop' });
  });

  it('continues an active goal before maxRounds and increments the round', async () => {
    await service.setGoal({ objective: 'Fix the bug', maxRounds: 3 });

    const controller = buildMockController();
    const decision = await decideGoalContinuation(controller as never, service);

    expect(decision.action).toBe('continue');
    if (decision.action === 'continue') {
      expect(decision.message).toContain('Fix the bug');
      expect(decision.message).toContain('Rounds used: 1/3');
    }
    expect((await service.getGoal())?.roundsUsed).toBe(1);
  });

  it('stops an active goal once maxRounds is exhausted', async () => {
    await service.setGoal({ objective: 'Long task', maxRounds: 2 });
    await service.recordRound();
    await service.recordRound();

    const controller = buildMockController();
    const decision = await decideGoalContinuation(controller as never, service);

    expect(decision).toEqual({ action: 'stop' });
    expect(controller.ui.warn).toHaveBeenCalledWith(expect.stringContaining('2 rounds'));
  });

  it('asks the user after completion and ends on confirm', async () => {
    await service.setGoal({ objective: 'Ship it' });
    await service.completeGoal({ summary: 'All tests pass' });

    const controller = buildMockController();
    controller.inputManager.requestInput.mockResolvedValue('y');

    const decision = await decideGoalContinuation(controller as never, service);

    expect(decision).toEqual({ action: 'stop' });
    expect(controller.inputManager.requestInput).toHaveBeenCalledTimes(1);
    // Goal stays completed (user confirmed).
    expect((await service.getGoal())?.status).toBe('completed');
  });

  it('ends with clear when the user stops a completed goal', async () => {
    await service.setGoal({ objective: 'Ship it' });
    await service.completeGoal({ summary: 'Done' });

    const controller = buildMockController();
    controller.inputManager.requestInput.mockResolvedValue('stop');

    const decision = await decideGoalContinuation(controller as never, service);

    expect(decision).toEqual({ action: 'stop' });
    expect(await service.getGoal()).toBeNull();
  });

  it('re-activates and continues when the user gives feedback after completion', async () => {
    await service.setGoal({ objective: 'Ship it' });
    await service.completeGoal({ summary: 'Done' });

    const controller = buildMockController();
    controller.inputManager.requestInput.mockResolvedValue('also update the docs');

    const decision = await decideGoalContinuation(controller as never, service);

    expect(decision.action).toBe('continue');
    if (decision.action === 'continue') {
      expect(decision.message).toContain('also update the docs');
      expect(decision.message).toContain('Rounds used: 1');
    }
    expect((await service.getGoal())?.status).toBe('active');
    expect((await service.getGoal())?.roundsUsed).toBe(1);
    expect((await service.getGoal())?.lastProgress).toContain('also update the docs');
  });

  it('re-activates and continues when verification fails, feeding the failure back', async () => {
    await service.setGoal({ objective: 'Green tests', verifyCommand: 'exit 1' });
    await service.completeGoal({ summary: 'Looks done' });

    const controller = buildMockController();

    const decision = await decideGoalContinuation(controller as never, service);

    expect(decision.action).toBe('continue');
    if (decision.action === 'continue') {
      expect(decision.message).toContain('Verification failed');
      expect(decision.message).toContain('Rounds used: 1');
    }
    expect((await service.getGoal())?.status).toBe('active');
    expect((await service.getGoal())?.roundsUsed).toBe(1);
    expect(controller.ui.warn).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
    // The user is NOT asked when verification failed — the loop just continues.
    expect(controller.inputManager.requestInput).not.toHaveBeenCalled();
  });

  it('still asks the user when verification passes', async () => {
    await service.setGoal({ objective: 'Green tests', verifyCommand: 'true' });
    await service.completeGoal({ summary: 'Verified done' });

    const controller = buildMockController();
    controller.inputManager.requestInput.mockResolvedValue('y');

    const decision = await decideGoalContinuation(controller as never, service);

    expect(decision).toEqual({ action: 'stop' });
    expect(controller.ui.success).toHaveBeenCalledWith(expect.stringContaining('verification passed'));
    expect(controller.inputManager.requestInput).toHaveBeenCalledTimes(1);
  });

  it('stops cleanly when the user confirmation prompt is interrupted', async () => {
    await service.setGoal({ objective: 'Ship it' });
    await service.completeGoal({ summary: 'Done' });

    const controller = buildMockController();
    controller.inputManager.requestInput.mockRejectedValue(new Error('Interrupted'));

    const decision = await decideGoalContinuation(controller as never, service);

    expect(decision).toEqual({ action: 'stop' });
  });
});
