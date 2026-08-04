import type { AgentRoleDefinition } from '../../../shared/agent-roles';
import { EXPERIMENTAL_FLAG_PI_AGENT_HARNESS } from '../../../shared/experimental-features';
import { getExperimentalFlagSync } from '../../settings/experimental-ipc';
import { engineTurnBackend } from './engine-backend';
import { externalCliTurnBackend } from './external-cli-backend';
import type { AgentRuntime, TurnSegmentRequest } from './types';

export type {
  TurnBackend,
  TurnBackendCapabilities,
  AgentRuntime,
  AgentRuntimeCapabilities,
  TurnSegmentRequest,
  TurnSegmentResult,
} from './types';
export { engineTurnBackend } from './engine-backend';
export { externalCliTurnBackend } from './external-cli-backend';

let piBackendPromise: Promise<AgentRuntime> | undefined;
const loadPiAgentHarnessTurnBackend = (): Promise<AgentRuntime> => {
  piBackendPromise ??= import('./pi-agent-harness-backend')
    .then(({ piAgentHarnessTurnBackend }) => piAgentHarnessTurnBackend);
  return piBackendPromise;
};

/** Keep the experimental Pi runtime out of the default Engine startup chunk. */
export const piAgentHarnessTurnBackend: AgentRuntime = {
  id: 'pi-agent-harness',
  capabilities: {
    nativeCanvasTools: true,
    clarifications: 'native',
    historyFidelity: 'full',
    sessionResume: 'host',
    steering: 'native',
    compaction: 'host',
  },
  async runSegment(request: TurnSegmentRequest) {
    return (await loadPiAgentHarnessTurnBackend()).runSegment(request);
  },
  async steer(sessionId, text) {
    return (await loadPiAgentHarnessTurnBackend()).steer?.(sessionId, text) ?? false;
  },
  async followUp(sessionId, text) {
    return (await loadPiAgentHarnessTurnBackend()).followUp?.(sessionId, text) ?? false;
  },
};

/**
 * Pick the backend for one segment. Roles with an external driver run on
 * their CLI; everything else (default assistant + persona roles) runs on
 * the built-in engine.
 *
 * This is the single extension point for additional native runtimes:
 * route here, keep the executor's
 * abort/stream policies untouched, and declare honest capabilities so the
 * chat UI can degrade per the backend's capability matrix.
 */
export interface AgentRuntimeSelection {
  /** Test/dev override. Product selection normally comes from Experimental. */
  piEnabled?: boolean;
}

const resolvePiEnabled = (selection: AgentRuntimeSelection): boolean => {
  if (selection.piEnabled !== undefined) return selection.piEnabled;
  const env = process.env.PULSE_CANVAS_AGENT_RUNTIME?.trim().toLowerCase();
  if (env === 'pi') return true;
  if (env === 'engine') return false;
  return getExperimentalFlagSync(EXPERIMENTAL_FLAG_PI_AGENT_HARNESS);
};

export const resolveAgentRuntime = (
  role: AgentRoleDefinition | null,
  selection: AgentRuntimeSelection = {},
): AgentRuntime => {
  if (role?.external) return externalCliTurnBackend;
  if (!role && resolvePiEnabled(selection)) {
    return piAgentHarnessTurnBackend;
  }
  return engineTurnBackend;
};

/** @deprecated Use resolveAgentRuntime. */
export const resolveTurnBackend = resolveAgentRuntime;
