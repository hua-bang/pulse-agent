import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readRecordedLogs } from '../logs';
import { buildLogViewerHtml } from '../log-viewer';

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(), 'offline-traces-')); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });
const record = (runId: string, sessionId = 's-1', workspaceId = 'ws-1', startedAt = 10) => ({
  runId, sessionId, workspaceId, startedAt, trace: { toolCalls: [], readNodes: [], contextReads: [] },
});
async function save(detail: ReturnType<typeof record>) {
  await fs.writeFile(join(directory, `${detail.runId}.json`), JSON.stringify({ summary: detail, detail }));
}

it('reads without runtime/flags, filters exact session/workspace, and sorts newest first', async () => {
  const first = record('r-1'); const second = record('r-2', 's-1', 'ws-1', 20);
  await Promise.all([save(first), save(second), save(record('foreign', 's-1', 'ws-2')), save(record('other', 's-2'))]);
  expect(await readRecordedLogs({ sessionId: 's-1' }, 'ws-1', directory)).toEqual({ runs: [second, first] });
  expect(await readRecordedLogs({ runId: 'r-1' }, 'ws-1', directory)).toEqual({ runs: [first] });
  await expect(readRecordedLogs({ runId: 'foreign' }, 'ws-1', directory)).rejects.toMatchObject({ code: 'run_not_found' });
  expect(await readRecordedLogs({ sessionId: 'absent' }, 'ws-1', directory)).toEqual({ runs: [] });
});

it('reports missing/corrupt data and rejects unsafe IDs without touching unrelated paths', async () => {
  await expect(readRecordedLogs({ runId: '../secret' }, 'ws-1', directory)).rejects.toMatchObject({ code: 'invalid_argument' });
  await expect(readRecordedLogs({ runId: 'missing' }, 'ws-1', directory)).rejects.toMatchObject({ code: 'run_not_found' });
  expect(await readRecordedLogs({ sessionId: 's-1' }, 'ws-1', join(directory, 'missing'))).toEqual({ runs: [] });
  await fs.writeFile(join(directory, 'broken.json'), '{');
  await expect(readRecordedLogs({ runId: 'broken' }, 'ws-1', directory)).rejects.toMatchObject({ code: 'log_corrupt' });
});

it('retries a partial live-plugin write', async () => {
  const detail = record('r-1');
  await save(detail);
  const original = fs.readFile;
  const read = vi.spyOn(fs, 'readFile').mockImplementationOnce(async () => '{');
  read.mockImplementation(original);
  expect(await readRecordedLogs({ runId: 'r-1' }, 'ws-1', directory)).toEqual({ runs: [detail] });
  expect(read).toHaveBeenCalledTimes(2);
});

it('embeds trace content as inert JSON and bundles the reusable DevTools viewer', () => {
  const detail = { ...record('r-1'), userPromptPreview: '</script><script>alert(1)</script>\u2028' };
  const html = buildLogViewerHtml({ runs: [detail], workspaceId: 'ws-1' });
  expect(html).not.toContain(detail.userPromptPreview);
  const data = html.match(/type="application\/json">(.*?)<\/script>/s)![1];
  expect(JSON.parse(data).runs[0].userPromptPreview).toBe(detail.userPromptPreview);
  expect(html).toContain('Agent DevTools');
  expect(html).toContain('agent-debug-page');
});
