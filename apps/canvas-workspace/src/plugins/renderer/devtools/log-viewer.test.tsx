// @vitest-environment happy-dom
import { act } from 'react';
import { expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('boots the offline viewer without preload or runtime, selects runs, and omits live controls', async () => {
  const run = (runId: string, prompt: string) => ({
    workspaceId: 'ws-1', workspaceName: 'Offline workspace', sessionId: 's-1', runId,
    turnId: runId, messageIndex: 0, startedAt: 100, durationMs: 20,
    userPromptPreview: prompt, assistantPreview: '', toolCount: 0, readNodeCount: 0, isCurrent: false,
    trace: {
      runId, turnId: runId, sessionId: 's-1', createdAt: 100, startedAt: 100, finishedAt: 120,
      durationMs: 20, request: { userPromptPreview: prompt, attachmentCount: 0, selectedNodes: [], mentionedCanvases: [] },
      prompt: { systemPromptPreview: '', systemPromptChars: 0 }, toolCalls: [], readNodes: [], contextReads: [],
    },
  });
  document.body.innerHTML = '<div id="root"></div><script id="trace-data" type="application/json"></script>';
  document.getElementById('trace-data')!.textContent = JSON.stringify({
    runs: [run('r-2', 'Second turn'), run('r-1', 'First turn')], workspaceId: 'ws-1', sessionId: 's-1',
  });
  expect((window as unknown as { canvasWorkspace?: unknown }).canvasWorkspace).toBeUndefined();
  await act(async () => { await import('./log-viewer'); });
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Second turn'));
  expect(document.querySelector('[title="Refresh"]')).toBeNull();
  expect(document.querySelector('[title="Back to Canvas"]')).toBeNull();
  expect(document.querySelector('footer')?.textContent).toContain('Saved snapshot');
  await act(async () => { (document.querySelectorAll('.agent-debug-run-item')[1] as HTMLButtonElement).click(); });
  expect(document.querySelector('h1')?.textContent).toBe('First turn');
  expect(document.querySelectorAll('.agent-debug-run-item')).toHaveLength(2);
});
