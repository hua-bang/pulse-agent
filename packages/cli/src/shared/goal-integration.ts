import { homedir } from 'os';
import { join } from 'path';
import {
  createGoalIntegration,
  type GoalIntegration,
} from 'pulse-coder-plugin-kit/goal';

let activeGoalIntegration: GoalIntegration | undefined;

function getGoalIntegration(): GoalIntegration {
  activeGoalIntegration ??= createGoalIntegration({
    baseDir: join(homedir(), '.pulse-coder', 'cli-goals'),
    pluginName: 'cli-goal',
    pluginVersion: '0.0.1',
  });
  return activeGoalIntegration;
}

/** Lazy singleton so the CLI controller and command handlers share one goal store. */
export const goalIntegration: GoalIntegration = {
  get service() {
    return getGoalIntegration().service;
  },
  get enginePlugin() {
    return getGoalIntegration().enginePlugin;
  },
  initialize: () => getGoalIntegration().initialize(),
};

/**
 * Rebinds the goal store to a per-session scope. Called after a session is
 * created/resumed so `/goal` and the continuation loop target the session's
 * goal, not a global default. The engine plugin keeps the same service
 * instance; only its backing file changes. Returns the bound scope name.
 */
export async function bindGoalScope(scope: string): Promise<string> {
  const service = goalIntegration.service;
  const result = await service.setScope(scope);
  return result.scope;
}
