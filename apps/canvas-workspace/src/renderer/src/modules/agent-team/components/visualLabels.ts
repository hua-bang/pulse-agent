const TASK_STATUS_LABELS: Record<string, string> = {
  proposed: 'Proposed', planned: 'Planned', todo: 'Todo', in_progress: 'Running',
  needs_input: 'Needs input', needs_review: 'Needs review', blocked: 'Blocked',
  done: 'Done', failed: 'Failed', round_checkpoint: 'Checkpoint',
};

export const agentTeamStatusLabel = (status: string): string => (
  TASK_STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
);

export const agentSessionHealthSuffix = (health?: string): string => (
  health === 'dead' || health === 'missing'
    ? ' · offline'
    : health === 'queued' ? ' · queued' : ''
);
