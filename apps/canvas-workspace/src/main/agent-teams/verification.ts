import { exec } from 'child_process';
import { statSync } from 'fs';
import type { TaskVerificationResult } from 'pulse-coder-agent-teams/runtime';

export const TASK_VERIFY_TIMEOUT_MS = 120_000;
export const INTEGRATION_VERIFY_TIMEOUT_MS = 15 * 60_000;
const VERIFY_OUTPUT_TAIL_CHARS = 2_000;

export function isExistingDirectory(value: string): boolean {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}

export function runTaskVerification(
  command: string,
  cwd: string | undefined,
  timeoutMs = TASK_VERIFY_TIMEOUT_MS,
): Promise<TaskVerificationResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    exec(command, {
      cwd: cwd && isExistingDirectory(cwd) ? cwd : undefined,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const output = `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`.trim();
      const exitCode = error == null
        ? 0
        : typeof error.code === 'number' ? error.code : null;
      resolve({
        command,
        ok: error == null,
        exitCode,
        durationMs: Date.now() - startedAt,
        outputTail: output.slice(-VERIFY_OUTPUT_TAIL_CHARS),
        at: Date.now(),
      });
    });
  });
}
