import z from "zod";
import { spawn } from "child_process";
import type { Tool, ToolExecutionContext } from "../shared/types";
import { truncateOutput } from "./utils";

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 600000;
// Mirrors the old execSync maxBuffer. Output past this is dropped (the pipe is
// still drained so the child never blocks on a full buffer) rather than failing
// the whole command.
const MAX_OUTPUT_BYTES = 1024 * 1024 * 10; // 10MB
// Grace period between SIGTERM and SIGKILL so a well-behaved process can flush
// and exit cleanly, while a stuck one is still guaranteed to die.
const KILL_GRACE_MS = 2000;

export const BashTool: Tool<
  { command: string; timeout?: number; cwd?: string; description?: string },
  { output: string; error?: string; exitCode?: number }
> = {
  name: 'bash',
  description: 'Execute a bash command and return the output. Supports timeout and working directory configuration.',
  inputSchema: z.object({
    command: z.string().describe('The bash command to execute'),
    timeout: z.number().optional().describe('Optional timeout in milliseconds (max 600000ms / 10 minutes). Defaults to 120000ms (2 minutes).'),
    cwd: z.string().optional().describe('Optional working directory for command execution. Defaults to current directory.'),
    description: z.string().optional().describe('Optional description of what this command does (for logging/debugging)'),
  }),
  execute: async ({ command, timeout = DEFAULT_TIMEOUT_MS, cwd }, context?: ToolExecutionContext) => {
    // Validate timeout
    if (timeout && (timeout < 0 || timeout > MAX_TIMEOUT_MS)) {
      throw new Error('Timeout must be between 0 and 600000ms (10 minutes)');
    }

    const effectiveTimeout = timeout || DEFAULT_TIMEOUT_MS;
    const abortSignal = context?.abortSignal;

    if (abortSignal?.aborted) {
      return { output: '', error: 'Command aborted before execution', exitCode: 1 };
    }

    return new Promise((resolve) => {
      // `spawn` (async) instead of `execSync` (sync) keeps the event loop free —
      // critical when the engine runs on a host's main thread (e.g. the Electron
      // app), where a blocking call freezes the whole UI for the command's
      // duration. stdin is closed (`ignore`) so a command that reads stdin gets
      // EOF immediately instead of hanging until the timeout.
      const child = spawn(command, {
        shell: '/bin/bash',
        cwd: cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let outputTruncated = false;
      let settled = false;
      let timedOut = false;
      let aborted = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;

      const collect = (chunk: Buffer, isStderr: boolean): void => {
        // Keep reading (draining the pipe) even past the cap so the child never
        // blocks on a full stdout/stderr buffer; just stop accumulating. Buffers
        // are concatenated and decoded once at the end so a multi-byte UTF-8
        // character split across chunk boundaries is never corrupted.
        if (isStderr) {
          if (stderrBytes >= MAX_OUTPUT_BYTES) return;
          stderrChunks.push(chunk);
          stderrBytes += chunk.length;
          if (stderrBytes >= MAX_OUTPUT_BYTES) outputTruncated = true;
          return;
        }
        if (stdoutBytes >= MAX_OUTPUT_BYTES) return;
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
        if (stdoutBytes >= MAX_OUTPUT_BYTES) outputTruncated = true;
      };

      const decodeStdout = (): string => Buffer.concat(stdoutChunks).toString('utf-8');
      const decodeStderr = (): string => Buffer.concat(stderrChunks).toString('utf-8');

      const killChild = (signal: NodeJS.Signals): void => {
        try {
          child.kill(signal);
        } catch {
          // Process may already be gone.
        }
        if (!killTimer) {
          killTimer = setTimeout(() => killChild('SIGKILL'), KILL_GRACE_MS);
        }
      };

      const onTimeout = (): void => {
        timedOut = true;
        killChild('SIGTERM');
      };

      const onAbort = (): void => {
        aborted = true;
        killChild('SIGTERM');
      };

      const timeoutTimer = setTimeout(onTimeout, effectiveTimeout);
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      const finish = (result: { output: string; error?: string; exitCode?: number }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        abortSignal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

      child.stdout?.on('data', (chunk: Buffer) => collect(chunk, false));
      child.stderr?.on('data', (chunk: Buffer) => collect(chunk, true));

      child.on('error', (err: Error) => {
        const stderr = decodeStderr();
        finish({
          output: truncateOutput(decodeStdout()),
          error: truncateOutput(stderr || err.message || String(err)),
          exitCode: 1,
        });
      });

      child.on('close', (code: number | null) => {
        const stdout = decodeStdout();
        const stderr = decodeStderr();

        if (timedOut) {
          finish({
            output: truncateOutput(stdout),
            error: truncateOutput(`Command timed out after ${effectiveTimeout}ms\n${stderr}`),
            exitCode: code ?? 1,
          });
          return;
        }

        if (aborted) {
          finish({
            output: truncateOutput(stdout),
            error: truncateOutput(`Command aborted\n${stderr}`),
            exitCode: code ?? 1,
          });
          return;
        }

        if (code === 0) {
          let out = stdout || '(command completed with no output)';
          if (outputTruncated) {
            out += `\n\n... [output exceeded ${MAX_OUTPUT_BYTES} bytes and was truncated] ...`;
          }
          finish({ output: truncateOutput(out), exitCode: 0 });
          return;
        }

        finish({
          output: truncateOutput(stdout),
          error: truncateOutput(stderr),
          exitCode: code ?? 1,
        });
      });
    });
  },
};

export default BashTool;
