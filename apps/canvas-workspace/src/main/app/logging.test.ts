import { mkdtemp, readFile, readdir, rm, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileLogger, resolveMainLogLimits } from './logging';

describe('file logger', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'canvas-logger-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('serializes concurrent writes in call order', async () => {
    const logger = createFileLogger({ logDir: dir, maxBytes: 1_000_000 });
    await Promise.all(Array.from({ length: 30 }, (_, index) => (
      logger.writeLog('test', `line-${String(index).padStart(2, '0')}`)
    )));
    await logger.flush();
    const content = await readFile(join(dir, 'app.log'), 'utf-8');
    const positions = Array.from({ length: 30 }, (_, index) => (
      content.indexOf(`line-${String(index).padStart(2, '0')}`)
    ));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('suppresses repeated messages and writes one summary', async () => {
    let now = 1_000;
    const logger = createFileLogger({
      logDir: dir,
      maxBytes: 1_000_000,
      dedupeWindowMs: 10_000,
      now: () => now,
    });
    await logger.writeLog('console', 'duplicate warning', 'source:1');
    now += 10;
    await logger.writeLog('console', 'duplicate warning', 'source:1');
    now += 10;
    await logger.writeLog('console', 'duplicate warning', 'source:1');
    await logger.writeLog('console', 'next message');
    await logger.flush();

    const content = await readFile(join(dir, 'app.log'), 'utf-8');
    expect(content.match(/duplicate warning/g)).toHaveLength(1);
    expect(content).toContain('previous log repeated 2 times');
    expect(content).toContain('next message');
  });

  it('flushes a terminal duplicate run exactly once', async () => {
    const logger = createFileLogger({ logDir: dir, maxBytes: 1_000_000 });
    await logger.writeLog('console', 'terminal warning');
    await logger.writeLog('console', 'terminal warning');
    await logger.writeLog('console', 'terminal warning');

    await logger.flush();
    await logger.flush();

    const content = await readFile(join(dir, 'app.log'), 'utf-8');
    expect(content.match(/terminal warning/g)).toHaveLength(1);
    expect(content.match(/previous log repeated 2 times/g)).toHaveLength(1);
  });

  it('rotates logs with a bounded number of backups', async () => {
    const logger = createFileLogger({ logDir: dir, maxBytes: 180, maxBackups: 2 });
    for (let index = 0; index < 8; index++) {
      await logger.writeLog('test', `entry-${index}-${'x'.repeat(80)}`);
    }
    await logger.flush();

    const files = (await readdir(dir)).sort();
    expect(files).toContain('app.log');
    expect(files).toContain('app.log.1');
    expect(files.filter(file => file.startsWith('app.log.'))).toHaveLength(2);
  });

  it('truncates a single oversized record to the configured bound', async () => {
    const logger = createFileLogger({ logDir: dir, maxBytes: 180, maxBackups: 1 });
    await logger.writeLog('console', 'x'.repeat(2_000));
    await logger.flush();

    expect((await stat(join(dir, 'app.log'))).size).toBeLessThanOrEqual(180);
    expect(await readFile(join(dir, 'app.log'), 'utf-8')).toContain('[log entry truncated]');
  });

  it('clamps extreme environment limits', () => {
    expect(resolveMainLogLimits({
      PULSE_CANVAS_LOG_MAX_BYTES: '999999999999',
      PULSE_CANVAS_LOG_MAX_BACKUPS: '1000000.9',
      PULSE_CANVAS_LOG_DEDUPE_MS: '-5',
    })).toEqual({
      maxBytes: 100 * 1024 * 1024,
      maxBackups: 10,
      dedupeWindowMs: 0,
    });
  });

  it('keeps identical same-millisecond logs when dedupe is disabled', async () => {
    const logger = createFileLogger({
      logDir: dir,
      maxBytes: 1_000_000,
      dedupeWindowMs: 0,
      now: () => 1_000,
    });
    await logger.writeLog('console', 'keep both');
    await logger.writeLog('console', 'keep both');
    await logger.flush();

    const content = await readFile(join(dir, 'app.log'), 'utf-8');
    expect(content.match(/keep both/g)).toHaveLength(2);
    expect(content).not.toContain('previous log repeated');
  });
});
