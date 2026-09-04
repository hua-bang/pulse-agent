// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../coding-agent/surface', () => ({
  AgentNodeBody: ({ node, forceTeamWarmup }: { node: { id: string }; forceTeamWarmup?: boolean }) => (
    <span data-node-id={node.id} data-warmup={String(!!forceTeamWarmup)} />
  ),
}));

import { RuntimeMounts } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('RuntimeMounts', () => {
  it('keeps every teammate runtime mounted and warms it during startup', async () => {
    const nodes = ['node-1', 'node-2'].map((id) => ({
      id, type: 'agent' as const, title: id, x: 0, y: 0, width: 320, height: 240,
      data: { sessionId: `session-${id}`, agentType: 'codex' },
    }));
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => { root.render(<RuntimeMounts nodes={nodes} starting terminal={{ onUpdate: vi.fn() }} />); });
    expect(host.querySelectorAll('[data-node-id]')).toHaveLength(2);
    expect([...host.querySelectorAll('[data-warmup]')].every((node) => node.getAttribute('data-warmup') === 'true')).toBe(true);
    await act(async () => { root.unmount(); });
  });
});
