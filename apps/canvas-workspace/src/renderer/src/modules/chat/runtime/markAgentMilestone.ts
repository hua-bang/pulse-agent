import type { AgentObservabilityMarkInput } from '../../../../../shared/agent-observability';

export const markAgentMilestone = (
  runId: string,
  milestone: AgentObservabilityMarkInput['milestone'],
  timestamp = Date.now(),
): void => {
  void window.canvasWorkspace.agent.markObservability?.({ runId, milestone, timestamp })
    .catch(() => undefined);
};
