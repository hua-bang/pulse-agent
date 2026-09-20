import { mkdtemp, readFile, mkdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => ({ root: '' }));
vi.mock('../../../../main/agent/config-scope', () => ({ scopeRootDir: (scope: { workspaceId?: string }) => scope.workspaceId ? join(config.root, scope.workspaceId) : config.root }));
import { deliverPageResult, splitReadingText } from './reading-output';
import type { PageRunResult } from './types';

function result(text = 'Visible text'): PageRunResult {
  return { status: 'read_complete', reason: 'Observed end', verified: false, steps: [], elapsedMs: 10,
    usage: { jevCalls: 1, inputTokens: 20, outputTokens: 2 },
    reading: { observations: 1, characters: text.length, truncated: false,
      entries: [{ step: 0, url: 'https://example.test', title: 'Title', text, scrollUp: false, scrollDown: false, scrollAreas: [] }] } };
}
beforeEach(async () => { config.root = await mkdtemp(join(tmpdir(), 'page-run-output-test-')); });
afterEach(async () => { await rm(config.root, { recursive: true, force: true }); });

describe('reading output delivery', () => {
  it('keeps small responses inline', async () => {
    const output = JSON.parse(await deliverPageResult('ws', result()));
    expect(output).toMatchObject({ formatVersion: 2, reading: { inlineComplete: true } });
    expect(output.traceFile).toBeUndefined();
  });

  it('returns ordered small files with every captured character and a complete audit', async () => {
    const source = result('中文🙂 paragraph\n'.repeat(2_000));
    const output = JSON.parse(await deliverPageResult('__global_chat__', source));
    expect(JSON.stringify(output).length).toBeLessThan(12_000);
    expect(output.reading).toMatchObject({ inlineComplete: false, truncated: false });
    const contents = [];
    for (const part of output.reading.parts) {
      const path = join(output.reading.directory, part.fileName);
      const text = await readFile(path, 'utf8');
      expect(text.length).toBeLessThanOrEqual(5_000);
      expect(text.split('\n').length).toBeLessThanOrEqual(500);
      expect(text).not.toContain('�');
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      contents.push(text);
    }
    expect(contents.join('')).toBe(source.reading!.entries[0].text);
    expect(JSON.parse(await readFile(output.traceFile, 'utf8'))).toEqual(source);
  });

  it('preserves Unicode, blank lines and ordering at every split', () => {
    for (const text of ['x'.repeat(4_999) + '🙂末尾', '\n'.repeat(48_000), '中'.repeat(48_000)]) {
      const parts = splitReadingText(text);
      expect(parts.join('')).toBe(text);
      expect(parts.every(part => part.length <= 5_000 && part.split('\n').length <= 500)).toBe(true);
    }
  });

  it('does not follow workspace or output symlinks or accept traversal', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'page-run-external-test-'));
    try {
      await symlink(outside, join(config.root, 'evil'));
      await mkdir(join(config.root, 'ws'));
      await symlink(outside, join(config.root, 'ws', 'page-runs'));
      for (const scope of ['evil', 'ws', '../escape', '/tmp']) {
        const output = JSON.parse(await deliverPageResult(scope, result('x'.repeat(20_000))));
        expect(output.errorCode).toBe('reading_delivery_failed');
        expect(output.traceFile).toBeUndefined();
        expect(output.reading.entries[0].text.length).toBe(20_000);
      }
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});
