import { FileGoalPluginService } from './service.js';
import { buildGoalContinuationMessage } from './integration.js';
import type { Goal } from './types.js';

// ---------------------------------------------------------------------------
// Host-provided IO boundaries
// ---------------------------------------------------------------------------
//
// The runner owns the goal state machine but never touches the real world.
// The host injects exactly the three IO capabilities it needs:
//
// - runOnce: execute ONE agent round for a given user message, return whether
//   it was aborted and the round's result text.
// - confirm: ask the user a yes/stop/feedback question (used ONLY after the
//   model declares completion — the final gate, never auto-accepted).
// - verify (optional): run the user-configured verification command.
//
// Everything else — when to continue, when to re-arm after failed verification,
// the maxRounds guard, the continuation message text — is here, so the state
// machine is fully unit-testable without a host.

export interface GoalRunOnceResult {
  aborted: boolean;
  result: string;
}

export interface GoalRunOnce {
  (message: string): Promise<GoalRunOnceResult>;
}

export interface GoalConfirm {
  (question: string, context?: string): Promise<string>;
}

export interface GoalVerifyResult {
  ok: boolean;
  output: string;
}

export interface GoalVerify {
  (command: string): Promise<GoalVerifyResult>;
}

export type GoalLoopEndReason =
  | 'no-goal'          // no active goal from the start, or it was cleared externally
  | 'user-confirmed'   // model completed + user confirmed
  | 'cleared'          // user answered stop/clear at the confirmation prompt
  | 'max-rounds'       // active goal exhausted its maxRounds
  | 'aborted';         // a round was aborted (or the confirmation prompt was interrupted)

export interface GoalLoopResult {
  reason: GoalLoopEndReason;
  roundsRun: number;
}

export interface GoalLoopOptions {
  service: FileGoalPluginService;
  runOnce: GoalRunOnce;
  confirm: GoalConfirm;
  verify?: GoalVerify;
  /** Called before each continuation round with the 1-based round number. */
  onRoundStart?: (round: number) => void;
  /** Called with host-facing status text (verification passed/failed, feedback). */
  onMessage?: (message: string) => void;
}

const CONFIRM_QUESTION =
  'The agent says the goal is complete. Confirm? (y=end / stop=stop / type anything else to continue with your feedback)';

/**
 * Runs the goal state machine to completion:
 *
 *   active → run a round → active (auto-continue until maxRounds)
 *                         → completed → verify → user confirm → stop
 *                                     ↓ (verify failed)        ↓ (feedback)
 *                         → re-arm active ←────────────────────┘
 *
 * This is the Codex-style loop moved out of the host: the host only supplies
 * `runOnce`/`confirm`/`verify` and reads the end reason.
 */
export async function runGoalLoop(options: GoalLoopOptions): Promise<GoalLoopResult> {
  let roundsRun = 0;
  const { service } = options;

  while (true) {
    const goal = await service.getGoal();

    if (!goal || goal.status !== 'active' && goal.status !== 'completed') {
      return { reason: 'no-goal', roundsRun };
    }

    if (goal.status === 'active') {
      if (goal.maxRounds !== undefined && goal.roundsUsed >= goal.maxRounds) {
        options.onMessage?.(
          `Goal not met after ${goal.roundsUsed} rounds. Stopping — review with /goal status, then /goal clear or set a new goal.`,
        );
        return { reason: 'max-rounds', roundsRun };
      }

      await service.recordRound();
      const latest = (await service.getGoal())!;
      const progress = latest.lastProgress ? `Last progress: ${latest.lastProgress}` : '';
      const message = buildGoalContinuationMessage(latest, progress);

      roundsRun += 1;
      options.onRoundStart?.(roundsRun);

      const result = await options.runOnce(message);
      if (result.aborted) {
        return { reason: 'aborted', roundsRun };
      }

      continue;
    }

    // goal.status === 'completed'
    const outcome = await decideAfterCompletion(options, goal);
    if (outcome.action === 'stop') {
      return { reason: outcome.reason, roundsRun };
    }
    // Re-armed to active (or was re-armed by the host): loop continues.
  }
}

type CompletionOutcome =
  | { action: 'stop'; reason: GoalLoopEndReason }
  | { action: 'continue' };

async function decideAfterCompletion(
  options: GoalLoopOptions,
  goal: Goal,
): Promise<CompletionOutcome> {
  const { service, verify, confirm } = options;

  // 1. Objective verification first: if a verify command exists, the host runs
  //    it before asking the user. Failure re-activates the goal and feeds the
  //    failure output back so the next round fixes it.
  if (goal.verifyCommand && verify) {
    const verified = await verify(goal.verifyCommand);
    if (!verified.ok) {
      options.onMessage?.(`Goal verification FAILED: ${goal.verifyCommand}`);
      const feedback = `Verification failed:\n${verified.output}`;
      await rearmActiveGoal(service, goal);
      await service.recordRound();
      await service.setProgress(feedback);
      return { action: 'continue' };
    }
    options.onMessage?.(`Goal verification passed: ${goal.verifyCommand}`);
  }

  // 2. User confirmation is the final gate — never skip it.
  let answer: string;
  try {
    answer = await confirm(
      CONFIRM_QUESTION,
      goal.completedSummary ? `Completion summary:\n${goal.completedSummary}` : undefined,
    );
  } catch {
    // Interrupted (e.g. Ctrl+C during the prompt): stop cleanly.
    return { action: 'stop', reason: 'aborted' };
  }

  const normalized = answer.trim().toLowerCase();
  if (normalized === 'y' || normalized === 'yes' || normalized === 'confirm') {
    options.onMessage?.('Goal complete.');
    return { action: 'stop', reason: 'user-confirmed' };
  }
  if (normalized === 'stop' || normalized === 'clear') {
    await service.clearGoal();
    options.onMessage?.('Goal stopped.');
    return { action: 'stop', reason: 'cleared' };
  }

  // User gave feedback or asked for more work: re-activate and continue.
  const feedback = answer.trim() || 'User requested further work';
  await rearmActiveGoal(service, goal);
  await service.recordRound();
  await service.setProgress(`User feedback: ${feedback}`);
  options.onMessage?.(`Continuing with feedback: ${feedback}`);
  return { action: 'continue' };
}

/** Re-activates a completed goal, preserving its objective/verify/maxRounds. */
async function rearmActiveGoal(
  service: FileGoalPluginService,
  goal: Goal,
): Promise<void> {
  await service.setGoal({
    objective: goal.objective,
    verifyCommand: goal.verifyCommand,
    maxRounds: goal.maxRounds,
  });
}
