import { execFile, spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { canUseRuntime, type AuthPrincipal } from './shares.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 50_000;
const KILL_GRACE_MS = 2_000;

export type RemoteBuiltinToolName = 'bash' | 'read' | 'write' | 'edit' | 'ls' | 'grep';

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const omitted = text.length - MAX_OUTPUT_CHARS;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n... [truncated ${omitted} chars]`;
}

function resolveRemotePath(baseDir: string, target?: string): string {
  if (!target || !target.trim()) return baseDir;
  const trimmed = target.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2));
  return isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed);
}

async function runBash(
  input: Record<string, unknown>,
  baseDir: string,
  signal: AbortSignal,
): Promise<{ output: string; error?: string; exitCode: number }> {
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command.trim()) {
    throw new Error('command is required');
  }
  const rawTimeout = typeof input.timeout === 'number' ? input.timeout : DEFAULT_TIMEOUT_MS;
  if (rawTimeout < 0 || rawTimeout > MAX_TIMEOUT_MS) {
    throw new Error('Timeout must be between 0 and 600000ms (10 minutes)');
  }
  const effectiveTimeout = rawTimeout || DEFAULT_TIMEOUT_MS;
  const cwd = resolveRemotePath(baseDir, typeof input.cwd === 'string' ? input.cwd : undefined);

  if (signal.aborted) {
    return { output: '', error: 'Command aborted before execution', exitCode: 1 };
  }

  return await new Promise((resolvePromise) => {
    const child = spawn(command, {
      shell: '/bin/bash',
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
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

    const killChild = (sig: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, sig);
        } else {
          child.kill(sig);
        }
      } catch {
        // Already exited.
      }
    };

    const scheduleForceKill = (): void => {
      killChild('SIGTERM');
      killTimer = setTimeout(() => killChild('SIGKILL'), KILL_GRACE_MS);
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      scheduleForceKill();
    }, effectiveTimeout);

    const onAbort = (): void => {
      aborted = true;
      scheduleForceKill();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const finish = (result: { output: string; error?: string; exitCode: number }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener('abort', onAbort);
      resolvePromise(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => collect(chunk, false));
    child.stderr?.on('data', (chunk: Buffer) => collect(chunk, true));

    child.on('error', (err) => {
      finish({ output: '', error: err.message, exitCode: 1 });
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const combined = stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr;
      const suffix = outputTruncated ? '\n[output exceeded 10MB cap]' : '';
      const output = truncateOutput(combined + suffix);

      if (aborted) {
        finish({ output, error: 'Command aborted', exitCode: 1 });
        return;
      }
      if (timedOut) {
        finish({
          output,
          error: `Command timed out after ${effectiveTimeout}ms`,
          exitCode: 124,
        });
        return;
      }
      const exitCode = code ?? 0;
      finish({
        output,
        ...(exitCode !== 0 ? { error: `Command exited with code ${exitCode}` } : {}),
        exitCode,
      });
    });
  });
}

async function runRead(
  input: Record<string, unknown>,
  baseDir: string,
): Promise<{ content: string; totalLines: number }> {
  const rawPath = typeof input.filePath === 'string' ? input.filePath : '';
  if (!rawPath.trim()) throw new Error('filePath is required');
  const filePath = resolveRemotePath(baseDir, rawPath);
  const stats = await stat(filePath).catch(() => undefined);
  if (!stats) throw new Error(`File does not exist: ${filePath}`);
  if (stats.isDirectory()) {
    throw new Error(`Cannot read directory: ${filePath}. Use 'ls' tool to list directory contents.`);
  }
  const buffer = await readFile(filePath);
  if (buffer.subarray(0, 8192).includes(0)) {
    throw new Error(`Cannot read binary file: ${filePath} (${stats.size} bytes).`);
  }
  const content = buffer.toString('utf-8');
  const lines = content.split('\n');
  const totalLines = lines.length;
  const offset = typeof input.offset === 'number' ? input.offset : undefined;
  const limit = typeof input.limit === 'number' ? input.limit : undefined;
  if (offset === undefined && limit === undefined) {
    return { content: truncateOutput(content), totalLines };
  }
  const start = Math.max(0, offset ?? 0);
  const end = limit !== undefined ? start + Math.max(0, limit) : lines.length;
  return { content: truncateOutput(lines.slice(start, end).join('\n')), totalLines };
}

async function runWrite(
  input: Record<string, unknown>,
  baseDir: string,
): Promise<{ success: boolean; created: boolean; bytes: number }> {
  const rawPath = typeof input.filePath === 'string' ? input.filePath : '';
  const content = typeof input.content === 'string' ? input.content : '';
  if (!rawPath.trim()) throw new Error('filePath is required');
  const filePath = resolveRemotePath(baseDir, rawPath);
  const fileExists = await access(filePath).then(() => true, () => false);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
  return { success: true, created: !fileExists, bytes: Buffer.byteLength(content, 'utf-8') };
}

async function runEdit(
  input: Record<string, unknown>,
  baseDir: string,
): Promise<{ success: boolean; replacements: number; preview?: string }> {
  const rawPath = typeof input.filePath === 'string' ? input.filePath : '';
  const oldString = typeof input.oldString === 'string' ? input.oldString : '';
  const newString = typeof input.newString === 'string' ? input.newString : '';
  const replaceAll = input.replaceAll === true;
  if (!rawPath.trim()) throw new Error('filePath is required');
  if (oldString === newString) throw new Error('old_string and new_string must be different');
  const filePath = resolveRemotePath(baseDir, rawPath);
  const content = await readFile(filePath, 'utf-8');
  if (!content.includes(oldString)) {
    throw new Error(`old_string not found in file: ${filePath}`);
  }
  const changedIndex = content.indexOf(oldString);
  let newContent: string;
  let replacements: number;
  if (replaceAll) {
    const parts = content.split(oldString);
    replacements = parts.length - 1;
    newContent = parts.join(newString);
  } else {
    replacements = 1;
    newContent = content.slice(0, changedIndex) + newString + content.slice(changedIndex + oldString.length);
  }
  await writeFile(filePath, newContent, 'utf-8');
  const previewStart = Math.max(0, changedIndex - 120);
  const previewEnd = Math.min(newContent.length, changedIndex + newString.length + 120);
  return {
    success: true,
    replacements,
    preview: truncateOutput(newContent.slice(previewStart, previewEnd)),
  };
}

async function runLs(
  input: Record<string, unknown>,
  baseDir: string,
): Promise<{ files: string[] }> {
  const dirPath = resolveRemotePath(baseDir, typeof input.path === 'string' ? input.path : undefined);
  const files = await readdir(dirPath);
  return { files };
}

async function runGrep(
  input: Record<string, unknown>,
  baseDir: string,
): Promise<{ output: string; matches?: number }> {
  const pattern = typeof input.pattern === 'string' ? input.pattern : '';
  if (!pattern) throw new Error('pattern is required');
  const searchPath = resolveRemotePath(baseDir, typeof input.path === 'string' ? input.path : undefined);
  const outputMode =
    input.outputMode === 'content' || input.outputMode === 'count' ? input.outputMode : 'files_with_matches';
  const args: string[] = [];
  if (outputMode === 'files_with_matches') args.push('-l');
  else if (outputMode === 'count') args.push('-c');
  else args.push('-n');
  if (input.caseInsensitive === true) args.push('-i');
  if (input.multiline === true) args.push('-U', '--multiline-dotall');
  if (typeof input.context === 'number' && input.context > 0 && outputMode === 'content') {
    args.push('-C', String(input.context));
  }
  if (typeof input.glob === 'string' && input.glob) args.push('--glob', input.glob);
  if (typeof input.type === 'string' && input.type) args.push('--type', input.type);
  args.push('--', pattern, searchPath);

  let raw = '';
  try {
    const res = await execFileAsync('rg', args, { maxBuffer: MAX_OUTPUT_BYTES });
    raw = res.stdout;
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string };
    if (e.code === 1) {
      return { output: '', matches: 0 };
    }
    if (e.code === 'ENOENT') {
      // Minimal VPS without ripgrep: fall back to GNU grep.
      const grepArgs = [
        outputMode === 'files_with_matches' ? '-rl' : outputMode === 'count' ? '-rc' : '-rn',
        ...(input.caseInsensitive === true ? ['-i'] : []),
        '-E',
        '--',
        pattern,
        searchPath,
      ];
      try {
        const res = await execFileAsync('grep', grepArgs, { maxBuffer: MAX_OUTPUT_BYTES });
        raw = res.stdout;
      } catch (grepErr) {
        const ge = grepErr as { code?: number };
        if (ge.code === 1) return { output: '', matches: 0 };
        throw grepErr;
      }
    } else {
      throw err;
    }
  }

  let lines = raw.split('\n').filter((line) => line.length > 0);
  const offset = typeof input.offset === 'number' && input.offset > 0 ? input.offset : 0;
  const headLimit = typeof input.headLimit === 'number' && input.headLimit > 0 ? input.headLimit : 0;
  if (offset > 0) lines = lines.slice(offset);
  if (headLimit > 0) lines = lines.slice(0, headLimit);
  return { output: truncateOutput(lines.join('\n')), matches: lines.length };
}

export async function handleToolExecRequest(
  req: IncomingMessage,
  res: ServerResponse,
  principal: AuthPrincipal,
  readJsonBody: (req: IncomingMessage) => Promise<Record<string, unknown>>,
  sendJson: (res: ServerResponse, status: number, body: unknown) => void,
): Promise<void> {
  if (!canUseRuntime(principal)) {
    sendJson(res, 403, { ok: false, error: 'forbidden: role cannot execute remote tools' });
    return;
  }

  const body = await readJsonBody(req);
  const tool = body.tool as RemoteBuiltinToolName;
  const input = (body.input && typeof body.input === 'object' ? body.input : {}) as Record<string, unknown>;
  const baseDir =
    typeof body.cwd === 'string' && body.cwd.trim()
      ? resolveRemotePath(homedir(), body.cwd.trim())
      : homedir();

  const controller = new AbortController();
  const onClose = (): void => {
    if (!res.writableEnded) controller.abort();
  };
  req.once('close', onClose);

  try {
    let result: unknown;
    switch (tool) {
      case 'bash':
        result = await runBash(input, baseDir, controller.signal);
        break;
      case 'read':
        result = await runRead(input, baseDir);
        break;
      case 'write':
        result = await runWrite(input, baseDir);
        break;
      case 'edit':
        result = await runEdit(input, baseDir);
        break;
      case 'ls':
        result = await runLs(input, baseDir);
        break;
      case 'grep':
        result = await runGrep(input, baseDir);
        break;
      default:
        sendJson(res, 400, { ok: false, error: `unsupported tool: ${String(tool)}` });
        return;
    }
    sendJson(res, 200, { ok: true, result });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    req.off('close', onClose);
  }
}
