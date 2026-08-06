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
