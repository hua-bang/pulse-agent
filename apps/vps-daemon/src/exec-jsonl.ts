import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './auth.js';

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export interface ExecJsonlBody {
  command?: string;
  args?: string[];
  cwd?: string;
  prompt?: string;
  timeoutMs?: number;
}

/**
 * Stream JSONL output from an external CLI (e.g. Claude Code / Codex) over SSE.
 * Kills the child process (SIGTERM -> SIGKILL) if the client aborts or times out.
 */
export async function handleExecJsonl(
  req: IncomingMessage,
  res: ServerResponse,
  defaultCwd: string,
): Promise<void> {
  let body: ExecJsonlBody;
  try {
    body = await readJsonBody<ExecJsonlBody>(req);
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const command = body.command?.trim();
  const args = Array.isArray(body.args) ? body.args.map(String) : [];
  const cwd = body.cwd?.trim() || defaultCwd;
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const timeoutMs =
    typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? body.timeoutMs : DEFAULT_TIMEOUT_MS;

  if (!command) {
    sendJson(res, 400, { ok: false, error: 'Missing command' });
    return;
  }
  if (!existsSync(cwd)) {
    sendJson(res, 400, { ok: false, error: `Working directory does not exist: ${cwd}` });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const child = spawn(command, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  let stdoutRest = '';
  const stderrChunks: string[] = [];
  let finished = false;

  const killChild = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 2_000).unref();
  };

  const finish = (eventName: 'exit' | 'error', payload: unknown) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      res.end();
    } catch {
      /* client already closed */
    }
  };

  const timer = setTimeout(() => {
    killChild();
    finish('error', {
      message: `External agent run timed out after ${Math.round(timeoutMs / 1000)}s`,
    });
  }, timeoutMs);
  timer.unref();

  req.on('close', () => {
    if (!finished) {
      finished = true;
      clearTimeout(timer);
      killChild();
    }
  });

  child.on('error', (error) => {
    finish('error', { message: `Failed to launch "${command}": ${error.message}` });
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdoutRest += chunk;
    let newlineIndex = stdoutRest.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = stdoutRest.slice(0, newlineIndex);
      stdoutRest = stdoutRest.slice(newlineIndex + 1);
      if (!finished) {
        res.write(`event: line\ndata: ${JSON.stringify({ line })}\n\n`);
      }
      newlineIndex = stdoutRest.indexOf('\n');
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrChunks.push(chunk);
    if (stderrChunks.length > 20) stderrChunks.shift();
  });

  child.on('close', (code) => {
    if (stdoutRest && !finished) {
      res.write(`event: line\ndata: ${JSON.stringify({ line: stdoutRest })}\n\n`);
    }
    finish('exit', { code, stderrTail: stderrChunks.join('').trim().slice(-400) });
  });

  if (prompt) child.stdin.write(prompt);
  child.stdin.end();
}
