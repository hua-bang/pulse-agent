import type { AgentObservabilityMarkInput } from '../../../shared/agent-observability';

const ALLOWED_MILESTONES = new Set([
  'ui.request-dispatched',
  'ui.first-content-rendered',
]);

export const isAgentObservabilityMark = (
  value: unknown,
): value is AgentObservabilityMarkInput => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<AgentObservabilityMarkInput>;
  return typeof input.runId === 'string'
    && input.runId.length > 0
    && typeof input.timestamp === 'number'
    && Number.isFinite(input.timestamp)
    && typeof input.milestone === 'string'
    && ALLOWED_MILESTONES.has(input.milestone);
};
