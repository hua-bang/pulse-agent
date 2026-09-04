// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactViewer } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ArtifactViewer', () => {
  it('reads a file artifact and delegates closing the viewer', async () => {
    const onClose = vi.fn();
    const readFile = vi.fn().mockResolvedValue({ ok: true, content: '# Migration report' });
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ArtifactViewer
          artifact={{ id: 'artifact-1', teamId: 'team-1', taskId: 'task-1', agentId: 'ada', kind: 'file', title: 'report.md', uri: 'file:///tmp/report.md', createdAt: 1 }}
          taskTitle="Verify migration"
          agentName="Ada"
          readFile={readFile}
          onClose={onClose}
        />,
      );
    });

    expect(readFile).toHaveBeenCalledWith('/tmp/report.md');
    expect(host.textContent).toContain('# Migration report');
    expect(host.textContent).toContain('Task: Verify migration');
    await act(async () => { host.querySelector<HTMLButtonElement>('button')?.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => { root.unmount(); });
  });
});
