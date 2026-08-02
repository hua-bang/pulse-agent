import type { AgentRoleDefinition } from '../../../shared/agent-roles';
import { EXPERIMENTAL_FLAG_PI_NATIVE_CHAT } from '../../../shared/experimental-features';
import { getExperimentalFlagSync } from '../../settings/experimental-ipc';
import { engineTurnBackend } from './engine-backend';
import { externalCliTurnBackend } from './external-cli-backend';
import { piNativeTurnBackend } from './pi-native-backend';
import type { TurnBackend } from './types';

export type {
  TurnBackend,
  TurnBackendCapabilities,
  TurnSegmentRequest,
  TurnSegmentResult,
} from './types';
export { engineTurnBackend } from './engine-backend';
export { externalCliTurnBackend } from './external-cli-backend';
export { piNativeTurnBackend } from './pi-native-backend';

/**
 * Is the default assistant diverted to the pi backend? Two sources, OR'd
 * together, mirroring the debug-trace pattern so main-side reads stay in
 * lockstep with the Settings toggle:
 *   1. PULSE_CANVAS_PI_NATIVE_CHAT env var (escape hatch for tests / CI)
 *   2. the 'pi-native-chat' experimental flag (Settings → Experimental)
 * Read per turn, so toggling takes effect without an app restart.
 */
export function isPiNativeChatEnabled(): boolean {
  const value = process.env.PULSE_CANVAS_PI_NATIVE_CHAT?.trim().toLowerCase();
  if (value !== undefined && ['1', 'true', 'on', 'yes'].includes(value)) return true;
  if (value !== undefined && ['0', 'false', 'off', 'no'].includes(value)) return false;
  return getExperimentalFlagSync(EXPERIMENTAL_FLAG_PI_NATIVE_CHAT);
}

/**
 * Pick the backend for one segment. Roles with an external driver run on
 * their CLI; persona roles run on the built-in engine; the DEFAULT assistant
 * (null role) runs on the engine unless the pi-native-chat A/B instrument
 * diverts it to the pi backend.
 *
 * This is the single extension point for additional native backends:
 * route here, keep the executor's abort/stream policies untouched, and
 * declare honest capabilities so the chat UI can degrade per the backend's
 * capability matrix.
 */
export const resolveTurnBackend = (role: AgentRoleDefinition | null): TurnBackend => {
  if (role?.external) return externalCliTurnBackend;
  if (!role && isPiNativeChatEnabled()) return piNativeTurnBackend;
  return engineTurnBackend;
};
