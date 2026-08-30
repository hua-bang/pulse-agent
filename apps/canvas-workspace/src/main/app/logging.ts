import { app, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

export type WriteLog = (
  level: string,
  message: string,
  details?: string,
) => Promise<void>;

export interface MainLogger {
  writeLog: WriteLog;
  flush(): Promise<void>;
}

interface FileLoggerOptions {
  logDir: string;
  maxBytes?: number;
  maxBackups?: number;
  dedupeWindowMs?: number;
  now?: () => number;
}

export interface MainLogLimits {
  maxBytes: number;
  maxBackups: number;
  dedupeWindowMs: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_BACKUPS = 3;
const DEFAULT_DEDUPE_WINDOW_MS = 2_000;

const envInteger = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const value = Number(env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
};

export const resolveMainLogLimits = (env: NodeJS.ProcessEnv = process.env): MainLogLimits => ({
  maxBytes: envInteger(env, 'PULSE_CANVAS_LOG_MAX_BYTES', DEFAULT_MAX_BYTES, 1_024, 100 * 1024 * 1024),
  maxBackups: envInteger(env, 'PULSE_CANVAS_LOG_MAX_BACKUPS', DEFAULT_MAX_BACKUPS, 0, 10),
  dedupeWindowMs: envInteger(env, 'PULSE_CANVAS_LOG_DEDUPE_MS', DEFAULT_DEDUPE_WINDOW_MS, 0, 60_000),
});

export function createMainLogger(): MainLogger {
  const limits = resolveMainLogLimits();
  return createFileLogger({
    logDir: join(app.getPath('userData'), 'logs'),
    ...limits,
  });
}

export function createFileLogger(options: FileLoggerOptions): MainLogger {
  const logFile = join(options.logDir, 'app.log');
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxBackups = options.maxBackups ?? DEFAULT_MAX_BACKUPS;
  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const now = options.now ?? Date.now;
  let tail = Promise.resolve();
  let lastKey = '';
  let lastAt = 0;
  let suppressed = 0;

  const enqueue = (lines: string[]): Promise<void> => {
    const run = tail.then(async () => {
      await fs.mkdir(options.logDir, { recursive: true });
      for (const line of lines) {
        const bounded = boundLine(line, maxBytes);
        await rotateIfNeeded(logFile, Buffer.byteLength(bounded), maxBytes, maxBackups);
        await fs.appendFile(logFile, bounded);
      }
    }).catch((error) => {
      console.error('Failed to write log', error);
    });
    tail = run;
    return run;
  };

  const writeLog: WriteLog = (level, message, details) => {
    const timestamp = now();
    const key = `${level}\u0000${message}\u0000${details ?? ''}`;
    if (dedupeWindowMs > 0 && key === lastKey && timestamp - lastAt <= dedupeWindowMs) {
      suppressed += 1;
      lastAt = timestamp;
      return tail;
    }
    const lines: string[] = [];
    if (suppressed > 0) {
      lines.push(formatLine(timestamp, 'logger', `previous log repeated ${suppressed} times`));
    }
    lastKey = key;
    lastAt = timestamp;
    suppressed = 0;
    lines.push(formatLine(timestamp, level, message, details));
    return enqueue(lines);
  };

  const flush = (): Promise<void> => {
    if (suppressed === 0) return tail;
    const count = suppressed;
    suppressed = 0;
    return enqueue([formatLine(now(), 'logger', `previous log repeated ${count} times`)]);
  };

  return { writeLog, flush };
}

function formatLine(timestamp: number, level: string, message: string, details?: string): string {
  const prefix = `[${new Date(timestamp).toISOString()}] [${level}] ${message}\n`;
  return details ? `${prefix}${details}\n` : prefix;
}

function boundLine(line: string, maxBytes: number): string {
  if (maxBytes === 0 || Buffer.byteLength(line) <= maxBytes) return line;
  const marker = '\n[log entry truncated]\n';
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker));
  let content = Buffer.from(line).subarray(0, budget).toString('utf-8');
  while (Buffer.byteLength(content) + Buffer.byteLength(marker) > maxBytes) {
    content = content.slice(0, -1);
  }
  return `${content}${marker}`;
}

async function rotateIfNeeded(
  logFile: string,
  incomingBytes: number,
  maxBytes: number,
  maxBackups: number,
): Promise<void> {
  if (maxBytes === 0) return;
  let size = 0;
  try {
    size = (await fs.stat(logFile)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (size + incomingBytes <= maxBytes) return;
  if (maxBackups === 0) {
    await fs.unlink(logFile).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    return;
  }
  await fs.unlink(`${logFile}.${maxBackups}`).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  for (let index = maxBackups - 1; index >= 1; index--) {
    await fs.rename(`${logFile}.${index}`, `${logFile}.${index + 1}`).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
  await fs.rename(logFile, `${logFile}.1`).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
}

export function setupRendererLogIpc(writeLog: WriteLog): void {
  ipcMain.on('app:log', (_event, payload: {
    level?: string;
    message?: string;
    details?: string;
  } | undefined) => {
    void writeLog(
      payload?.level ?? 'renderer',
      payload?.message ?? 'log',
      payload?.details,
    );
  });
}

export function setupFatalErrorLogging(writeLog: WriteLog): void {
  process.on('uncaughtException', (error) => {
    console.error('Main uncaughtException', error);
    const details = error instanceof Error ? String(error.stack ?? error) : String(error);
    void writeLog('main', 'uncaughtException', details);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Main unhandledRejection', reason);
    void writeLog('main', 'unhandledRejection', String(reason));
  });
}
