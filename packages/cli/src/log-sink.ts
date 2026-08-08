import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { format } from 'util';

export type EngineLogLevel = 'log' | 'warn' | 'error';

export interface EngineLogEntry {
  at: number;
  level: EngineLogLevel;
  text: string;
}

interface EngineLogSinkOptions {
  filePath?: string;
  maxEntries?: number;
  maxFileBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 300;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

type ConsoleMethod = (...args: unknown[]) => void;

/**
 * Captures all `console.*` output (engine and plugin logging) away from
 * stdout so the Ink frame stays clean. Entries go to a log file plus an
 * in-memory ring buffer; a subscriber decides what surfaces in the UI.
 *
 * The Ink host renders with `patchConsole: false` and relies on this sink —
 * without it, engine logs would write straight into the terminal frame.
 */
export class EngineLogSink {
  readonly filePath: string;
  private readonly maxEntries: number;
  private readonly maxFileBytes: number;
  private readonly ring: EngineLogEntry[] = [];
  private listener: ((entry: EngineLogEntry) => void) | null = null;
  private stream: fs.WriteStream | null = null;
  private original: Partial<Record<'log' | 'info' | 'debug' | 'trace' | 'warn' | 'error', ConsoleMethod>> = {};
  private installed = false;
  /** Bytes written by this process; drives mid-session rotation. */
  private writtenBytes = 0;
  private rotating = false;

  constructor(options: EngineLogSinkOptions = {}) {
    this.filePath = options.filePath ?? path.join(homedir(), '.pulse-coder', 'logs', 'cli.log');
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  install(): void {
    if (this.installed) {
      return;
    }
    this.installed = true;

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const stats = fs.statSync(this.filePath, { throwIfNoEntry: false });
      if (stats && stats.size > this.maxFileBytes) {
        fs.renameSync(this.filePath, `${this.filePath}.old`);
      }
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
      // A stream 'error' with no listener THROWS, and nothing in the process
      // catches it — a write that fails after the stream opened (disk full, home
      // volume gone read-only, log file removed underneath us) would kill the
      // CLI mid-run, before shutdown() could save the session. File logging is a
      // convenience; degrade to the ring buffer instead of taking the host down.
      this.stream.on('error', () => {
        this.stream = null;
      });
    } catch {
      this.stream = null;
    }

    const capture = (level: EngineLogLevel): ConsoleMethod => (...args: unknown[]) => {
      this.record(level, args);
    };

    this.original = {
      log: console.log,
      info: console.info,
      debug: console.debug,
      trace: console.trace,
      warn: console.warn,
      error: console.error,
    };

    console.log = capture('log');
    console.info = capture('log');
    console.debug = capture('log');
    console.trace = capture('log');
    console.warn = capture('warn');
    console.error = capture('error');
  }

  /** Restores console methods and flushes the log file. */
  restore(): Promise<void> {
    if (!this.installed) {
      return Promise.resolve();
    }
    this.installed = false;
    if (this.original.log) console.log = this.original.log;
    if (this.original.info) console.info = this.original.info;
    if (this.original.debug) console.debug = this.original.debug;
    if (this.original.trace) console.trace = this.original.trace;
    if (this.original.warn) console.warn = this.original.warn;
    if (this.original.error) console.error = this.original.error;

    const stream = this.stream;
    this.stream = null;
    if (!stream) {
      return Promise.resolve();
    }
    return new Promise(resolve => stream.end(() => resolve()));
  }

  record(level: EngineLogLevel, args: unknown[]): void {
    const text = format(...args);
    const entry: EngineLogEntry = { at: Date.now(), level, text };

    this.ring.push(entry);
    if (this.ring.length > this.maxEntries) {
      this.ring.shift();
    }

    if (this.stream) {
      const stamp = new Date(entry.at).toISOString();
      const line = `${stamp} [${level}] ${text}\n`;
      this.stream.write(line);
      this.writtenBytes += Buffer.byteLength(line);
      // Rotation used to be evaluated only at install(), so a single long
      // session (or `--verbose`/`/debug on` left enabled) grew the file without
      // bound — the process never restarts to re-check it.
      if (this.writtenBytes >= this.maxFileBytes) {
        this.rotate();
      }
    }

    this.listener?.(entry);
  }

  /**
   * Closes the current file, moves it to `.old`, and reopens. Best effort.
   *
   * The rename waits for `end()` to flush: a WriteStream opens its fd lazily, so
   * renaming straight after a burst of synchronous writes would hit a file that
   * does not exist on disk yet. While the swap is in flight `stream` is null, so
   * those few lines reach the ring buffer and `/debug` but not the file.
   */
  private rotate(): void {
    if (this.rotating) {
      return;
    }
    this.rotating = true;

    const stream = this.stream;
    this.stream = null;
    this.writtenBytes = 0;

    const reopen = () => {
      this.rotating = false;
      // restore() may have run while the flush was in flight; don't resurrect
      // file logging after the sink was uninstalled.
      if (!this.installed) {
        return;
      }
      try {
        fs.renameSync(this.filePath, `${this.filePath}.old`);
        const next = fs.createWriteStream(this.filePath, { flags: 'a' });
        next.on('error', () => {
          this.stream = null;
        });
        this.stream = next;
      } catch {
        // Leave file logging off rather than take the host down; the ring buffer
        // and /debug keep working.
        this.stream = null;
      }
    };

    if (stream) {
      stream.end(reopen);
    } else {
      reopen();
    }
  }

  subscribe(listener: (entry: EngineLogEntry) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  entries(limit = this.maxEntries): EngineLogEntry[] {
    return this.ring.slice(-Math.max(0, limit));
  }

  count(): number {
    return this.ring.length;
  }
}
