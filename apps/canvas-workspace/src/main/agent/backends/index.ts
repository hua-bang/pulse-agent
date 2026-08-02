import type { AgentRoleDefinition } from '../../../shared/agent-roles';
import { engineTurnBackend } from './engine-backend';
import { externalCliTurnBackend } from './external-cli-backend';
import type { TurnBackend } from './types';

export type {
  TurnBackend,
  TurnBackendCapabilities,
  TurnSegmentRequest,
  TurnSegmentResult,
} from './types';
export { engineTurnBackend } from './engine-backend';
export { externalCliTurnBackend } from './external-cli-backend';

/**
 * Pick the backend for one segment. Roles with an external driver run on
 * their CLI; everything else (default assistant + persona roles) runs on
 * the built-in engine.
 *
 * This is the single extension point for additional native backends
 * (e.g. a pi-backed default assistant): route here, keep the executor's
 * abort/stream policies untouched, and declare honest capabilities so the
 * chat UI can degrade per the backend's capability matrix.
 */
export const resolveTurnBackend = (role: AgentRoleDefinition | null): TurnBackend =>
  role?.external ? externalCliTurnBackend : engineTurnBackend;
