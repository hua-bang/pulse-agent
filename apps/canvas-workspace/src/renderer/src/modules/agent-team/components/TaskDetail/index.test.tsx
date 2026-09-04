// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { TaskDetail } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TaskDetail', () => {
  it('presents task evidence and delegates artifact selection', async () => {
    const onSelectArtifact = vi.fn();
    const artifact = { id: 'artifact-1', teamId: 'team-1', kind: 'file', title: 'report.md', createdAt: 1 };
    const task = {
      key: 'task-1', title: 'Verify migration', description: 'Run the structure gate.', status: 'needs_review',
      ownerName: 'Ada', ownerKey: 'agent:ada', depKeys: ['task-0'], depLabels: ['Extract module'],
      artifactCount: 1, scope: ['renderer'], verify: 'pnpm typecheck', result: '13 tests pass',
      sourceTask: { id: 'task-1' },
    } as Parameters<typeof TaskDetail>[0]['task'];
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => {
      root.render(<TaskDetail task={task} artifacts={[artifact]} ownerAgentType="codex" selectedAgentKey="agent:ada" humanGate={<span>Approval needed</span>} onSelectArtifact={onSelectArtifact} />);
    });

    expect(host.textContent).toContain('Verify migration');
    expect(host.textContent).toContain('Extract module');
    expect(host.textContent).toContain('pnpm typecheck');
    expect(host.textContent).toContain('13 tests pass');
    expect(host.textContent).toContain('Approval needed');
    await act(async () => { host.querySelector<HTMLButtonElement>('.agent-team-detail__artifact-button')?.click(); });
    expect(onSelectArtifact).toHaveBeenCalledWith(artifact);

    await act(async () => { root.unmount(); });
  });
});
