import { spawn } from 'child_process';
import type { FileGoalPluginService } from 'pulse-coder-plugin-kit/goal';
import type { GoalVerifyResult } from 'pulse-coder-plugin-kit/goal';
import type { InkCoderController } from './ink-controller.js';
import { goalIntegration } from '../shared/goal-integration.js';

/**
 * Host IO wiring for the goal runner. The goal state machine lives in
 * plugin-kit (`runGoalLoop`); this file only supplies the three capabilities
 * the runner cannot do itself: resolving the goal service, running the
 * user-configured verify command, and nothing else.
 */

const GOAL_VERIFY_TIMEOUT_MS = 120_000;
const GOAL_VERIFY_MAX_BUFFER = 4_000;

export function getGoalService(controller: InkCoderController): FileGoalPluginService {
  const fromEngine = controller.agent.getService<FileGoalPluginService>('goalService');
  if (fromEngine) {
    return fromEngine;
  }
  // Engine plugin missing (e.g. a host that assembled plugins by hand): fall
  // back to the CLI-side singleton so /goal and continuation still work.
  return goalIntegration.service;
}

/**
 * Runs the user-configured verify command. The command is the user's own
 * explicit input, so it runs through the shell (equivalent to the user typing
 * it themselves). Output is bounded so a noisy command cannot blow up context.
 */
export function runGoalVerify(controller: InkCoderController, command: string): Promise<GoalVerifyResult> {
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
