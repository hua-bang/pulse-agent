import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { BenchmarkTrace } from './benchmark-trace.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('BenchmarkTrace', () => {
  it('writes JSONL events to stdout in jsonl mode', async () => {
    const stdout = new PassThrough();
    let output = '';
    stdout.setEncoding('utf8');
    stdout.on('data', chunk => { output += chunk; });

    const trace = new BenchmarkTrace({ outputFormat: 'jsonl', stdout });
    trace.emit({ type: 'run_start', model: 'gpt-test' });
    trace.emit({ type: 'run_end', status: 'completed' });
    await trace.close();

    expect(output.trim().split('\n').map(line => JSON.parse(line))).toEqual([
      expect.objectContaining({ type: 'run_start', model: 'gpt-test' }),
      expect.objectContaining({ type: 'run_end', status: 'completed' }),
    ]);
  });

  it('writes a trace file even when stdout remains text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-trace-test-'));
    tempDirs.push(dir);
    const traceFile = join(dir, 'trace.jsonl');
    const stdout = new PassThrough();

    const trace = new BenchmarkTrace({ outputFormat: 'text', traceFile, stdout });
    trace.emit({ type: 'tool_result', output: 'ok' });
    await trace.close();

    expect(await readFile(traceFile, 'utf8')).toContain('"type":"tool_result"');
  });

  it('bounds large event values', async () => {
    const stdout = new PassThrough();
    let output = '';
    stdout.setEncoding('utf8');
    stdout.on('data', chunk => { output += chunk; });

    const trace = new BenchmarkTrace({ outputFormat: 'jsonl', stdout, maxValueChars: 20 });
    trace.emit({ type: 'tool_result', output: 'x'.repeat(100) });
    await trace.close();

    const event = JSON.parse(output.trim());
    expect(event.output).toContain('[truncated]');
    expect(event.output.length).toBeLessThan(100);
  });
});
