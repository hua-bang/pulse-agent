import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EngineLogSink, type EngineLogEntry } from './log-sink.js';

describe('EngineLogSink', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-logsink-'));
    filePath = path.join(dir, 'cli.log');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('captures console output away from stdout and restores afterwards', async () => {
    const sink = new EngineLogSink({ filePath });
    const originalLog = console.log;
    sink.install();
    try {
      expect(console.log).not.toBe(originalLog);
      console.log('[PluginManager] %s', 'noise');
      console.warn('careful');

      const entries = sink.entries();
      expect(entries.map(entry => entry.level)).toEqual(['log', 'warn']);
      expect(entries[0].text).toBe('[PluginManager] noise');
    } finally {
      await sink.restore();
    }
    expect(console.log).toBe(originalLog);

    const written = await fs.readFile(filePath, 'utf-8');
    expect(written).toContain('[log] [PluginManager] noise');
    expect(written).toContain('[warn] careful');
  });

  it('survives a stream error instead of crashing the process', async () => {
    // A WriteStream 'error' with no listener throws, and nothing in the CLI
    // catches it — an async write failure (disk full, log dir removed) used to
    // take the whole host down mid-run, before shutdown() could save.
    const sink = new EngineLogSink({ filePath });
    sink.install();
    try {
      const stream = (sink as unknown as { stream: NodeJS.EventEmitter | null }).stream;
      expect(stream).not.toBeNull();

      expect(() => stream!.emit('error', new Error('ENOSPC'))).not.toThrow();
      // File logging is dropped, but the sink keeps serving the ring buffer.
      expect((sink as unknown as { stream: unknown }).stream).toBeNull();
      expect(() => sink.record('log', ['after the failure'])).not.toThrow();
      expect(sink.entries().map(entry => entry.text)).toContain('after the failure');
    } finally {
      await sink.restore();
    }
  });

  it('rotates mid-session once the file grows past the cap', async () => {
    // Rotation used to be evaluated only at install(), so one long-running
    // process grew cli.log without bound.
    const sink = new EngineLogSink({ filePath, maxFileBytes: 200 });
    sink.install();
    try {
      for (let index = 0; index < 20; index += 1) {
        console.log(`line ${index} ${'x'.repeat(40)}`);
        // Rotation waits for the stream to flush, so yield between writes.
        await new Promise(resolve => setImmediate(resolve));
      }
    } finally {
      await sink.restore();
    }

    const entries = await fs.readdir(dir);
    expect(entries.sort()).toEqual(['cli.log', 'cli.log.old']);
    // The live file holds only what was written since the last swap.
    const current = await fs.readFile(filePath, 'utf-8');
    expect(current.length).toBeLessThan(20 * 60);
    expect(await fs.readFile(`${filePath}.old`, 'utf-8')).not.toBe('');
  });

  it('notifies its subscriber and caps the ring buffer', () => {
    const sink = new EngineLogSink({ filePath, maxEntries: 2 });
    const seen: EngineLogEntry[] = [];
    sink.subscribe(entry => seen.push(entry));

    sink.record('log', ['a']);
    sink.record('log', ['b']);
    sink.record('error', ['c']);

    expect(seen).toHaveLength(3);
    expect(sink.count()).toBe(2);
    expect(sink.entries().map(entry => entry.text)).toEqual(['b', 'c']);
    expect(sink.entries(1).map(entry => entry.text)).toEqual(['c']);
  });
});
