import { describe, expect, it, vi } from 'vitest';

import { createAgentToolingQueue } from './agent-tooling-queue';
import type { AgentToolingAction, AgentToolingInstallResult } from './agent-tooling-manager';

describe('AgentToolingQueue', () => {
  it('runs an explicit update after an in-flight startup reconciliation', async () => {
    let finishStartup!: () => void;
    const startup = new Promise<void>((resolve) => { finishStartup = resolve; });
    const calls: AgentToolingAction[] = [];
    const ensureInstalled = vi.fn(async ({ action }: { action?: AgentToolingAction } = {}) => {
      const resolvedAction = action ?? 'reconcile';
      calls.push(resolvedAction);
      if (resolvedAction === 'reconcile') await startup;
      return { applied: resolvedAction === 'update' } as AgentToolingInstallResult;
    });
    const queue = createAgentToolingQueue(() => ({ ensureInstalled }));

    const startupResult = queue.run('reconcile');
    const updateResult = queue.run('update');
    await Promise.resolve();
    expect(calls).toEqual(['reconcile']);

    finishStartup();
    await expect(startupResult).resolves.toMatchObject({ applied: false });
    await expect(updateResult).resolves.toMatchObject({ applied: true });
    expect(calls).toEqual(['reconcile', 'update']);
  });
});
