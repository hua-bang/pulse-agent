import { spawn } from 'child_process';
import type { FileGoalPluginService } from 'pulse-coder-plugin-kit/goal';
import type { InkCoderController } from './ink-controller.js';

/** Goal continuation decisions made after each agent run. */
export type GoalContinueDecision =
  | { action: 'stop' }
  | { action: 'continue'; message: string };

const GOAL_VERIFY_TIMEOUT_MS = 120_000;
const GOAL_VERIFY_MAX_BUFFER = 4_000;

/**
 * Decides what happens after an agent run finished while a goal is active:
 * - No goal / cleared -> stop.
 * - Model declared completion (goal_complete): run the verify command if one
 *   was configured; on failure, re-activate and feed the failure output back.
 *   On success (or when there is no verify command), ask the user to confirm.
 *   y -> stop; stop/clear -> clear and stop; anything else -> continue with
 *   the user's feedback as the next round's instruction.
 * - Goal still active: continue automatically until maxRounds is exhausted.
 *
 * This is the "model declaration first, CLI confirmation as the safety net"
 * loop. The engine is never asked to loop itself — the CLI owns the budget.
 */
export async function decideGoalContinuation(
  controller: InkCoderController,
  goalService: FileGoalPluginService,
): Promise<GoalContinueDecision> {
  const goal = await goalService.getGoal();
  if (!goal) {
    return { action: 'stop' };
  }

  if (goal.status === 'completed') {
    return decideAfterModelCompletion(controller, goalService);
  }

  // Active: auto-continue with the maxRounds guard.
  if (goal.maxRounds !== undefined && goal.roundsUsed >= goal.maxRounds) {
    controller.ui.warn(
      `Goal not met after ${goal.roundsUsed} rounds. Stopping — review with /goal status, then /goal clear or set a new goal.`,
    );
    return { action: 'stop' };
  }

  await goalService.recordRound();
  const latest = (await goalService.getGoal())!;
  const progress = latest.lastProgress ? `\nLast progress: ${latest.lastProgress}` : '';
  return {
    action: 'continue',
    message: buildContinuationMessage(latest.objective, latest, progress),
  };
}

/**
 * Builds the next round's user message. The system prompt only carries STABLE
 * goal fields (see buildGoalPromptAppend); the per-round dynamic state — round
 * usage and last progress — rides this message instead, so the system prompt
 * never changes between rounds and provider prefix caches keep hitting.
 */
function buildContinuationMessage(objective: string, goal: NonNullable<Awaited<ReturnType<FileGoalPluginService['getGoal']>>>, progressSuffix = ''): string {
  const rounds = goal.maxRounds
    ? `${goal.roundsUsed}/${goal.maxRounds}`
    : `${goal.roundsUsed}`;
  return `Continue working toward the goal: ${objective}\nRounds used: ${rounds}${progressSuffix}`;
}

async function decideAfterModelCompletion(
  controller: InkCoderController,
  goalService: FileGoalPluginService,
): Promise<GoalContinueDecision> {
  const goal = await goalService.getGoal();
  if (!goal || goal.status !== 'completed') {
    return { action: 'stop' };
  }

  // 1. Objective verification first: if a verify command exists, the host runs
  //    it before asking the user. Failure re-activates the goal and feeds the
  //    failure output back so the next round fixes it.
  if (goal.verifyCommand) {
    const verified = await runGoalVerify(controller, goal.verifyCommand);
    if (!verified.ok) {
      controller.ui.warn(`Goal verification FAILED: ${goal.verifyCommand}`);
      const feedback = `Verification failed:\n${verified.output}`;
      await goalService.setGoal({
        objective: goal.objective,
        verifyCommand: goal.verifyCommand,
        maxRounds: goal.maxRounds,
      });
      await goalService.recordRound();
      await goalService.setProgress(feedback);
      const rearmed = (await goalService.getGoal())!;
      return {
        action: 'continue',
        message: buildContinuationMessage(goal.objective, rearmed, `\n${feedback}`),
      };
    }
    controller.ui.success(`Goal verification passed: ${goal.verifyCommand}`);
  }

  // 2. User confirmation is the final gate — never skip it.
  let answer: string;
  try {
    answer = await controller.inputManager.requestInput({
      id: `goal-confirm-${Date.now()}`,
      question: 'The agent says the goal is complete. Confirm? (y=end / stop=stop / type anything else to continue with your feedback)',
      context: goal.completedSummary ? `Completion summary:\n${goal.completedSummary}` : undefined,
      kind: 'approval',
      defaultAnswer: 'y',
      timeout: 0,
    });
  } catch {
    // Interrupted (e.g. Ctrl+C during the prompt): stop cleanly.
    return { action: 'stop' };
  }

  const normalized = answer.trim().toLowerCase();
  if (normalized === 'y' || normalized === 'yes' || normalized === 'confirm') {
    controller.ui.success('Goal complete.');
    return { action: 'stop' };
  }
  if (normalized === 'stop' || normalized === 'clear') {
    await goalService.clearGoal();
    controller.ui.info('Goal stopped.');
    return { action: 'stop' };
  }

  // User gave feedback or asked for more work: re-activate and continue.
  const feedback = answer.trim() || 'User requested further work';
  await goalService.setGoal({
    objective: goal.objective,
    verifyCommand: goal.verifyCommand,
    maxRounds: goal.maxRounds,
  });
  await goalService.recordRound();
  await goalService.setProgress(feedback);
  const rearmed = (await goalService.getGoal())!;
  return {
    action: 'continue',
    message: buildContinuationMessage(goal.objective, rearmed, `\nUser feedback: ${feedback}`),
  };
}

interface VerifyResult {
  ok: boolean;
  output: string;
}

/**
 * Runs the user-configured verify command. The command is the user's own
 * explicit input, so it runs through the shell (equivalent to the user typing
 * it themselves). Output is bounded so a noisy command cannot blow up context.
 */
function runGoalVerify(controller: InkCoderController, command: string): Promise<VerifyResult> {
  controller.ui.info(`Verifying goal: ${command}`);

  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, timeout: GOAL_VERIFY_TIMEOUT_MS });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, GOAL_VERIFY_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const output = [stdout.trim(), stderr.trim(), timedOut ? `Timed out after ${GOAL_VERIFY_TIMEOUT_MS / 1000}s` : '']
        .filter(Boolean)
        .join('\n')
        .slice(-GOAL_VERIFY_MAX_BUFFER);

      resolve({
        ok: !timedOut && code === 0,
        output: output || `(exit code ${code ?? 'unknown'})`,
      });
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `Failed to start verify command: ${error.message}` });
    });
  });
}
