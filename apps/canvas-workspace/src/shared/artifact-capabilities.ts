/**
 * Runtime capabilities an artifact page may invoke on its host.
 *
 * Trust model (each layer is independently enforced):
 * 1. Capabilities are DECLARED on the artifact record by its creator (code),
 *    never by the HTML — a page cannot grant itself anything.
 * 2. The viewer prepends a host-authored bridge script exposing only the
 *    declared capabilities, gated on a real user gesture.
 * 3. Main re-validates: artifact exists, capability declared, payload capped.
 * 4. Every successful write surfaces a host toast (audit visibility).
 */

export const ARTIFACT_CAPABILITY_MESSAGE = 'pulse-artifact-capability';
export const ARTIFACT_CAPABILITY_RESPONSE = 'pulse-artifact-capability-result';

export type ArtifactCapabilityName = 'memory.adopt' | 'skill.save';

export interface MemoryAdoptPayload {
  content: string;
  kind?: 'preference' | 'fact' | 'decision' | 'rule' | 'note';
  /** Target workspace id; omit for global memory. */
  workspaceId?: string;
}

export interface SkillSavePayload {
  name: string;
  description: string;
  body: string;
  scope: 'global' | 'workspace';
  /** Required when scope is 'workspace'. */
  workspaceId?: string;
}

export interface ArtifactCapabilityInvoke {
  /** The artifact's storage scope (may be the global sentinel). */
  workspaceId: string;
  artifactId: string;
  capability: ArtifactCapabilityName;
  payload: MemoryAdoptPayload | SkillSavePayload;
}

export interface ArtifactCapabilityResult {
  ok: boolean;
  /** Human-readable summary for the host audit toast (on success). */
  summary?: string;
  error?: string;
}

export interface ArtifactCapabilitiesApi {
  invoke: (request: ArtifactCapabilityInvoke) => Promise<ArtifactCapabilityResult>;
}
