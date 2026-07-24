import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';

import {
  measurePayloadSize,
  offloadToolOutput,
  buildStub,
  type OffloadStore,
} from './offload';

describe('measurePayloadSize', () => {
  it('counts string lengths, ignoring JSON structural overhead', () => {
    expect(measurePayloadSize('abc')).toBe(3);
    // Only the string field counts; numbers/keys/braces do not.
    expect(measurePayloadSize({ content: 'abcd', totalLines: 999 })).toBe(4);
  });

  it('sums nested strings (arrays + objects)', () => {
    const value = { results: [{ content: 'aa' }, { content: 'bbb' }] };
    expect(measurePayloadSize(value)).toBe(5);
  });

  it('tolerates cycles', () => {
    const a: any = { s: 'x' };
    a.self = a;
    expect(measurePayloadSize(a)).toBe(1);
  });
});

describe('offloadToolOutput', () => {
  const dirs: string[] = [];
  const makeStore = (): { store: OffloadStore; dir: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'offload-test-'));
    dirs.push(dir);
    const store: OffloadStore = {
      dir,
      async write(fileName, content) {
        const filePath = join(dir, fileName);
        await fs.writeFile(filePath, content, 'utf-8');
        return filePath;
      },
    };
    return { store, dir };
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('leaves small outputs untouched', async () => {
    const { store } = makeStore();
    const res = await offloadToolOutput('small', { toolName: 'x', threshold: 100, store });
    expect(res).toBeNull();
  });

  it('offloads a large plain string and returns a stub pointing at the file', async () => {
    const { store } = makeStore();
    const big = 'A'.repeat(500);
    const res = await offloadToolOutput(big, { toolName: 'bash', threshold: 100, store });
    expect(res).not.toBeNull();
    expect(typeof res!.output).toBe('string');
    expect(res!.output).toContain('offloaded to disk');
    expect(res!.output).toContain(res!.path);
    // Full content is preserved losslessly on disk.
    expect(readFileSync(res!.path, 'utf-8')).toBe(big);
  });

  it('preserves object shape by replacing only the dominant string field', async () => {
    const { store } = makeStore();
    const output = { content: 'B'.repeat(500), totalLines: 42 };
    const res = await offloadToolOutput(output, { toolName: 'read', threshold: 100, store });
    expect(res).not.toBeNull();
    const out = res!.output as { content: string; totalLines: number };
    // Metadata survives; only the big field became a stub.
    expect(out.totalLines).toBe(42);
    expect(out.content).toContain('offloaded to disk');
    expect(readFileSync(res!.path, 'utf-8')).toBe('B'.repeat(500));
  });

  it('offloads whole object as JSON when no single field exceeds threshold', async () => {
    const { store } = makeStore();
    // Two medium fields: aggregate 120 > threshold 100, but neither alone > 100.
    const output = { a: 'a'.repeat(60), b: 'b'.repeat(60) };
    const res = await offloadToolOutput(output, { toolName: 'tavily', threshold: 100, store });
    expect(res).not.toBeNull();
    expect(typeof res!.output).toBe('string');
    expect(res!.path.endsWith('.json')).toBe(true);
    const persisted = JSON.parse(readFileSync(res!.path, 'utf-8'));
    expect(persisted).toEqual(output);
  });

  it('does not offload an already-capped read result at exactly the threshold', async () => {
    const { store } = makeStore();
    // read caps content at MAX_TOOL_OUTPUT_LENGTH; payload equals threshold, not over.
    const output = { content: 'C'.repeat(30_000), totalLines: 1 };
    const res = await offloadToolOutput(output, { toolName: 'read', threshold: 30_000, store });
    expect(res).toBeNull();
  });

  it('dedupes identical content to the same file name (content hash)', async () => {
    const { store } = makeStore();
    const big = 'D'.repeat(500);
    const first = await offloadToolOutput(big, { toolName: 'mcp', threshold: 100, store });
    const second = await offloadToolOutput(big, { toolName: 'mcp', threshold: 100, store });
    expect(first!.path).toBe(second!.path);
  });
});

describe('buildStub', () => {
  it('includes a head/tail preview and omission marker for large content', () => {
    const content = 'H'.repeat(1000) + 'MIDDLE' + 'T'.repeat(1000);
    const stub = buildStub({ toolName: 'x', content, filePath: '/tmp/x.txt', previewChars: 50 });
    expect(stub).toContain('chars omitted');
    expect(stub).toContain('/tmp/x.txt');
    expect(stub).not.toContain('MIDDLE');
  });
});
