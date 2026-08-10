import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileGoalPluginService } from 'pulse-coder-plugin-kit/goal';
import type { InkCoderController } from './ink-controller.js';
import { handleCommand } from './controller-commands.js';

interface MockUi {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  section: ReturnType<typeof vi.fn>;
}

function buildMockController(service: FileGoalPluginService): InkCoderController {
  const ui: MockUi = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    section: vi.fn(),
  };
  const agent = {
    getService: vi.fn((name: string) => (name === 'goalService' ? service : undefined)),
  };
  return {
    ui,
    agent,
  } as unknown as InkCoderController;
}

let dir: string;
let service: FileGoalPluginService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goal-cmd-test-'));
  service = new FileGoalPluginService({ baseDir: dir, scope: 'scope' });
  await service.initialize();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('/goal command', () => {
  it('sets an active goal with an objective', async () => {
    const controller = buildMockController(service);
    await handleCommand(controller, 'goal', ['Fix', 'the', 'bug']);

    const goal = await service.getGoal();
    expect(goal?.objective).toBe('Fix the bug');
    expect(goal?.status).toBe('active');
    expect(controller.ui.success).toHaveBeenCalledWith('Goal set.');
    expect(controller.ui.section).toHaveBeenCalledWith('Active goal', expect.arrayContaining(['Objective: Fix the bug']));
  });

  it('parses --verify and --rounds flags', async () => {
    const controller = buildMockController(service);
    await handleCommand(controller, 'goal', ['Ship', 'it', '--verify', 'pnpm test', '--rounds', '4']);

    const goal = await service.getGoal();
    expect(goal?.objective).toBe('Ship it');
    expect(goal?.verifyCommand).toBe('pnpm test');
    expect(goal?.maxRounds).toBe(4);
  });

  it('shows a no-goal status', async () => {
    const controller = buildMockController(service);
    await handleCommand(controller, 'goal', ['status']);
    expect(controller.ui.info).toHaveBeenCalledWith(expect.stringContaining('No active goal'));
  });

  it('shows the active goal status', async () => {
    await service.setGoal({ objective: 'Visible objective' });
    await service.recordRound();

    const controller = buildMockController(service);
    await handleCommand(controller, 'goal', ['status']);

    expect(controller.ui.section).toHaveBeenCalledWith('Goal', expect.arrayContaining([
      'Objective: Visible objective',
      'Rounds used: 1',
    ]));
  });

  it('clears an active goal', async () => {
    await service.setGoal({ objective: 'To be cleared' });
    const controller = buildMockController(service);

    await handleCommand(controller, 'goal', ['clear']);
    expect(await service.getGoal()).toBeNull();
    expect(controller.ui.success).toHaveBeenCalledWith('Goal cleared.');
  });

  it('marks complete with a user summary', async () => {
    await service.setGoal({ objective: 'Done soon' });
    const controller = buildMockController(service);

    await handleCommand(controller, 'goal', ['complete', 'Verified', 'manually']);
    expect((await service.getGoal())?.status).toBe('completed');
    expect((await service.getGoal())?.completedSummary).toBe('Verified manually');
  });

  it('rejects an empty objective with usage guidance', async () => {
    const controller = buildMockController(service);
    await handleCommand(controller, 'goal', ['--verify', 'true']);

    expect(controller.ui.error).toHaveBeenCalledWith('Please provide a goal objective.');
    expect(await service.getGoal()).toBeNull();
  });

  it('shows usage help for bare /goal', async () => {
    const controller = buildMockController(service);
    await handleCommand(controller, 'goal', []);
    expect(controller.ui.section).toHaveBeenCalledWith('Goal usage', expect.arrayContaining([
      expect.stringContaining('/goal <objective>'),
    ]));
  });
});
