import type {
  AgentTeamAgentRecord,
  AgentTeamPhase,
  AgentTeamSnapshot,
  FrameNodeData,
} from '../../../../types';

interface Options {
  nodeId: string;
  nodeTitle: string;
  teamId?: string;
  data: FrameNodeData;
  runtime?: AgentTeamSnapshot['runtime'];
  phase: AgentTeamPhase;
  agents: AgentTeamAgentRecord[];
  teammates: AgentTeamAgentRecord[];
  graphTaskCount: number;
  graphAgentCount: number;
  rootFolder?: string;
}

const metadataString = (
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined => {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

export function createAgentTeamFramePresentation({
  nodeId,
  nodeTitle,
  teamId,
  data,
  runtime,
  phase,
  agents,
  teammates,
  graphTaskCount,
  graphAgentCount,
  rootFolder,
}: Options) {
  const tasks = runtime?.tasks ?? [];
  const lead = agents.find((agent) => agent.role === 'lead');
  const teamStatus = runtime?.team.status ?? 'planning';
  const isCompletedTeam = teamStatus === 'completed';
  const isCheckpoint = teamStatus === 'round_checkpoint';
  const checkpointRound = runtime?.checkpointRound;
  const teamTitle = runtime?.team.name ?? data.agentTeamName ?? nodeTitle;
  const teamCwd = lead?.cwd
    ?? metadataString(lead?.metadata, ['cwd'])
    ?? metadataString(lead?.sessionRef?.metadata, ['cwd'])
    ?? teammates.find((agent) => agent.cwd)?.cwd
    ?? metadataString(runtime?.team.metadata, ['cwd'])
    ?? rootFolder
    ?? '';
  const phaseTitle = phase === 'briefing'
    ? 'Briefing'
    : isCompletedTeam
      ? 'Completed'
      : isCheckpoint
        ? `Round ${checkpointRound ?? ''} Checkpoint`
        : phase === 'plan_review'
          ? 'Plan Review'
          : phase === 'starting'
            ? 'Starting Agents'
            : 'Executing';
  const graphTitle = phase === 'plan_review'
    ? 'Proposed task graph'
    : phase === 'starting'
      ? 'Starting task graph'
      : phase === 'executing'
        ? 'Live task graph'
        : 'Task graph';
  const graphSubtitle = phase === 'briefing'
    ? 'Brief Team Lead to generate a plan.'
    : phase === 'starting'
      ? 'Starting agent terminals before dispatching tasks.'
      : `${graphTaskCount} task${graphTaskCount === 1 ? '' : 's'} · ${graphAgentCount} teammate${graphAgentCount === 1 ? '' : 's'}`;

  return {
    lead,
    teamStatus,
    isCompletedTeam,
    isCheckpoint,
    checkpointRound,
    shouldShowLeadCommandSlot: phase === 'briefing' || phase === 'plan_review' || isCompletedTeam,
    teamTitle,
    teamCwd,
    phaseTitle,
    doneTaskCount: tasks.filter((task) => task.status === 'done').length,
    activeTaskCount: tasks.filter((task) => (
      task.status === 'in_progress'
      || task.status === 'needs_input'
      || task.status === 'needs_review'
    )).length,
    graphTitle,
    graphSubtitle,
    edgeMarkerId: `agent-team-dag-arrow-${(teamId ?? nodeId).replace(/[^\w-]/g, '-')}`,
    canPauseTeam: phase === 'executing'
      && teamStatus !== 'paused'
      && teamStatus !== 'completed'
      && teamStatus !== 'failed',
    canResumeTeam: phase === 'executing' && teamStatus === 'paused',
    canDispatch: phase === 'executing'
      && teamStatus === 'running'
      && tasks.some((task) => task.status === 'todo')
      && agents.some((agent) => agent.role === 'teammate' && agent.status === 'idle'),
  };
}
