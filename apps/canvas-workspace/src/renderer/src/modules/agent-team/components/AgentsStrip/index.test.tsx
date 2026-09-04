// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AgentsStrip } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AgentsStrip', () => {
  it('renders agent state and delegates selection', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    const agent = { key: 'agent:a', name: 'Ada', role: 'teammate' as const, status: 'running', taskCount: 2, doneCount: 1, runningCount: 1, blockedCount: 0, artifactCount: 3 };
    await act(async () => { root.render(<AgentsStrip agents={[agent]} selectedAgentKey="" planReview={false} readOnly={false} agentOptions={[]} onSelect={onSelect} onChangeAgentType={vi.fn()} />); });
    expect(host.textContent).toContain('Tasks 1/2');
    await act(async () => { host.querySelector<HTMLButtonElement>('button')?.click(); });
    expect(onSelect).toHaveBeenCalledWith(agent);
    await act(async () => { root.unmount(); });
  });
});
