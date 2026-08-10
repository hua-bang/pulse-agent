import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface BenchmarkEvent {
  type: string;
  [key: string]: unknown;
}

export interface BenchmarkTraceOptions {
  outputFormat?: 'text' | 'jsonl';
  traceFile?: string;
  stdout?: Pick<NodeJS.WritableStream, 'write'>;
  maxValueChars?: number;
}

const DEFAULT_MAX_VALUE_CHARS = 20_000;

export class BenchmarkTrace {
  private readonly outputFormat: 'text' | 'jsonl';
  private readonly stdout: Pick<NodeJS.WritableStream, 'write'>;
  private readonly fileStream?: WriteStream;
  private readonly maxValueChars: number;
  private fileError?: Error;

  constructor(options: BenchmarkTraceOptions = {}) {
    this.outputFormat = options.outputFormat ?? 'text';
    this.stdout = options.stdout ?? process.stdout;
    this.maxValueChars = options.maxValueChars ?? DEFAULT_MAX_VALUE_CHARS;

    if (options.traceFile) {
      const filePath = resolve(options.traceFile);
      mkdirSync(dirname(filePath), { recursive: true });
      this.fileStream = createWriteStream(filePath, { encoding: 'utf8', flags: 'w' });
      this.fileStream.on('error', error => {
        this.fileError = error;
      });
    }
  }

  emit(event: BenchmarkEvent): void {
    const sanitized = sanitizeValue({
      timestamp: new Date().toISOString(),
      ...event,
    }, this.maxValueChars);
    const line = `${JSON.stringify(sanitized)}\n`;
    if (this.outputFormat === 'jsonl') {
      this.stdout.write(line);
    }
    this.fileStream?.write(line);
  }

  async close(): Promise<void> {
    if (!this.fileStream) {
      return;
    }
    if (this.fileError) {
      throw this.fileError;
    }
    const stream = this.fileStream;
    await new Promise<void>((resolvePromise, reject) => {
      stream.once('finish', resolvePromise);
      stream.once('error', reject);
      stream.end();
    });
  }
}

function sanitizeValue(value: unknown, maxValueChars: number, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > maxValueChars
      ? `${value.slice(0, maxValueChars)}\n[truncated]`
      : value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= 8) {
    return '[max depth]';
  }
  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, maxValueChars, seen, depth + 1));
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sanitizeValue(item, maxValueChars, seen, depth + 1),
  ]));
}
