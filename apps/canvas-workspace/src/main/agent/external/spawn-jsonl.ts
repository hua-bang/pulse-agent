/**
 * Shared process scaffolding for JSONL-streaming CLI adapters: spawn, pipe
 * the prompt through stdin, split stdout into lines, keep a stderr tail for
 * diagnosis, and enforce abort + timeout with SIGTERM→SIGKILL. Adapters keep
 * only what actually differs per family: argv building and line parsing.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';

export const EXTERNAL_SEGMENT_TIMEOUT_MS = 10 * 60_000;

export interface JsonlCliRun {
  command: string;
  args: string[];
  cwd: string;
  /** Written to stdin, then stdin is closed. */
  prompt: string;
  abortSignal: AbortSignal;
  timeoutMs?: number;
  onLine: (line: string) => void;
}

export interface JsonlCliExit {
  code: number | null;
  stderrTail: string;
}

export async function runJsonlCli(run: JsonlCliRun): Promise<JsonlCliExit> {
  // A missing cwd makes spawn fail with a misleading ENOENT on the COMMAND;
  // surface the actual misconfiguration instead.
  if (!existsSync(run.cwd)) {
    throw new Error(`External role working directory does not exist: ${run.cwd}`);
  }
  const timeoutMs = run.timeoutMs ?? EXTERNAL_SEGMENT_TIMEOUT_MS;

  return await new Promise<JsonlCliExit>((resolve, reject) => {
    const child = spawn(run.command, run.args, {
      cwd: run.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdoutRest = '';
    const stderrChunks: string[] = [];
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.abortSignal.removeEventListener('abort', onAbort);
      fn();
    };
    const fail = (message: string) => settle(() => reject(new Error(message)));

    const killChild = () => {
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000).unref();
    };
    const onAbort = () => { killChild(); fail('External agent run aborted'); };
    const timer = setTimeout(() => {
      killChild();
      fail(`External agent run timed out after ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);
    timer.unref();

    if (run.abortSignal.aborted) { onAbort(); return; }
    run.abortSignal.addEventListener('abort', onAbort);

    child.on('error', (err) => fail(`Failed to launch "${run.command}": ${err.message}`));

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutRest += chunk;
      let newlineIndex = stdoutRest.indexOf('\n');
      while (newlineIndex >= 0) {
        run.onLine(stdoutRest.slice(0, newlineIndex));
        stdoutRest = stdoutRest.slice(newlineIndex + 1);
        newlineIndex = stdoutRest.indexOf('\n');
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrChunks.push(chunk);
      if (stderrChunks.length > 20) stderrChunks.shift();
    });

    child.on('close', (code) => {
      if (stdoutRest) run.onLine(stdoutRest);
      settle(() => resolve({ code, stderrTail: stderrChunks.join('').trim().slice(-400) }));
    });

    child.stdin.write(run.prompt);
    child.stdin.end();
  });
}
