import type {
  AgentToolingAction,
  AgentToolingInstallResult,
  AgentToolingManager,
} from './agent-tooling-manager';

export interface AgentToolingQueue {
  run(action: AgentToolingAction): Promise<AgentToolingInstallResult>;
}

export function createAgentToolingQueue(
  getManager: () => Pick<AgentToolingManager, 'ensureInstalled'>,
): AgentToolingQueue {
  let queue: Promise<void> = Promise.resolve();
  return {
    run: (action) => {
      const operation = queue.then(() => getManager().ensureInstalled({ action }));
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}
