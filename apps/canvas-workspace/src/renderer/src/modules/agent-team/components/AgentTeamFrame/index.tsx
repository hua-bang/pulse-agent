import { useMemo, useState } from 'react';
import './index.css';
import {
  createAgentTeamGraphAgents,
  createAgentTeamWorkspaceModel,
} from '../../model/workspaceModel';
import { HumanGateCard, hasConcreteHumanGatePrompt } from '../HumanGateCard';
import { TeamCommand } from '../TeamCommand';
import { createAgentDetailModel } from '../AgentDetail';
import { AgentInspector } from '../AgentInspector';
import { ArtifactViewer } from '../ArtifactViewer';
import { LeadDock } from '../LeadDock';
import { TaskWorkspace } from '../TaskWorkspace';
import { TeamHeader } from '../TeamHeader';
import { RuntimeMounts } from '../RuntimeMounts';
import { useAgentTeamFrameSelection } from './useAgentTeamFrameSelection';
import { useAgentTeamWorkspaceController } from '../../controller/useAgentTeamWorkspaceController';
import { useAppShell } from '../../../../shared/appShell';
import { AGENT_REGISTRY } from '../../../../config/agentRegistry';
import { useWorkspaceActive } from '../../../../hooks/useWorkspaceActive';
import type {
  AgentNodeData,
  AgentTeamAgentRecord,
  AgentTeamArtifactRecord,
  AgentTeamHumanGateRecord,
  AgentTeamTaskRecord,
  CanvasNode,
  FrameNodeData,
} from '../../../../types';

interface AgentTeamFrameProps {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  onRemoveNodes?: (ids: string[]) => void;
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  readOnly?: boolean;
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

const isHumanFacingGate = (gate: AgentTeamHumanGateRecord): boolean =>
  gate.metadata?.audience !== 'lead' && hasConcreteHumanGatePrompt(gate.prompt);

const isTeamAgentNode = (node: CanvasNode, teamId: string): node is CanvasNode & { data: AgentNodeData } =>
  node.type === 'agent'
  && (node.data as AgentNodeData).agentTeamId === teamId
  && !!(node.data as AgentNodeData).agentTeamAgentId;

// Agent Teams currently supports only Claude Code and Codex for teammates.
const TEAM_AGENT_OPTIONS = AGENT_REGISTRY.filter((def) => def.id === 'claude-code' || def.id === 'codex');

export const AgentTeamFrame = ({
  node,
  getAllNodes,
  onUpdate,
  onRemoveNodes,
  rootFolder,
  workspaceId,
  workspaceName,
  readOnly = false,
}: AgentTeamFrameProps) => {
  const data = node.data as FrameNodeData;
  const teamId = data.agentTeamId;
  const workspaceActive = useWorkspaceActive();
  const [gateAnswers, setGateAnswers] = useState<Record<string, string>>({});
  const { confirm } = useAppShell();
  const controller = useAgentTeamWorkspaceController({
    api: window.canvasWorkspace?.agentTeams,
    workspaceId,
    teamId,
    workspaceActive,
  });
  const { snapshot, loading, error, planAction, teamAction } = controller;
  const runtime = snapshot?.runtime;
  const workspaceModel = useMemo(
    () => snapshot ? createAgentTeamWorkspaceModel(snapshot) : null,
    [snapshot],
  );
  const agents = workspaceModel?.agents ?? [];
  const tasks = runtime?.tasks ?? [];
  const gates = runtime?.humanGates ?? [];
  const artifacts = runtime?.artifacts ?? [];
  const openGates = gates.filter((gate) => gate.status === 'open');
  const lead = useMemo(() => agents.find((agent) => agent.role === 'lead'), [agents]);
  const teammates = workspaceModel?.teammates ?? [];
  const phase = workspaceModel?.phase ?? 'briefing';
  const teamStatus = runtime?.team.status ?? 'planning';
  const isCompletedTeam = teamStatus === 'completed';
  const isCheckpoint = teamStatus === 'round_checkpoint';
  const checkpointRound = runtime?.checkpointRound;
  const shouldShowLeadCommandSlot = phase === 'briefing' || phase === 'plan_review' || isCompletedTeam;
  const plan = snapshot?.pendingPlan;
  const teamAgentNodes = teamId
    ? (getAllNodes?.() ?? []).filter((candidate) => isTeamAgentNode(candidate, teamId))
    : [];
  const agentNodeByAgentId = new Map(
    teamAgentNodes.map((agentNode) => [agentNode.data.agentTeamAgentId!, agentNode]),
  );
  const leadCanvasNode = lead ? agentNodeByAgentId.get(lead.id) : undefined;
  const teammateCanvasNodes = teammates
    .map((agent) => agentNodeByAgentId.get(agent.id))
    .filter((agentNode): agentNode is CanvasNode & { data: AgentNodeData } => !!agentNode);

  const agentById = workspaceModel?.agentById ?? new Map<string, AgentTeamAgentRecord>();
  const taskById = workspaceModel?.taskById ?? new Map<string, AgentTeamTaskRecord>();
  const artifactsByTask = workspaceModel?.artifactsByTask
    ?? new Map<string, AgentTeamArtifactRecord[]>();
  const orderedTasks = workspaceModel?.orderedTasks ?? [];
  const defaultTask = workspaceModel?.defaultTask;
  const graphTasks = workspaceModel?.tasks ?? [];
  const graphRounds = workspaceModel?.rounds ?? [];
  const roundOptions = workspaceModel?.roundOptions ?? [];
  const graphAgents = createAgentTeamGraphAgents({
    phase,
    plan,
    tasks: graphTasks,
    teammates,
    artifacts,
    agentNodeByAgentId,
    sessions: snapshot?.sessions,
  });
  const selection = useAgentTeamFrameSelection({
    phase,
    artifacts,
    graphTasks,
    graphAgents,
    orderedTasks,
    taskById,
    defaultTask,
  });
  const {
    graphTaskByKey,
    selectedTask,
    selectedGraphTask,
    selectedArtifact,
    selectedAgentKey,
    detailPanelMode,
    agentInspectorMode,
    agentViewMode,
    agentInspectorOpen,
  } = selection;
  const selectedTaskArtifacts = selectedTask
    ? artifactsByTask.get(selectedTask.id) ?? []
    : [];
  const selectedTaskGate = selectedTask
    ? openGates.find((gate) => gate.taskId === selectedTask.id)
    : undefined;
  const selectedHumanTaskGate = selectedTaskGate && isHumanFacingGate(selectedTaskGate)
    ? selectedTaskGate
    : undefined;
  const globalGate = openGates.find((gate) =>
    isHumanFacingGate(gate) && (!selectedTask || gate.taskId !== selectedTask.id)
  );
  const selectedArtifactTask = selectedArtifact?.taskId
    ? taskById.get(selectedArtifact.taskId)
    : undefined;
  const selectedArtifactAgent = selectedArtifact?.agentId
    ? agentById.get(selectedArtifact.agentId)
    : undefined;
  const selectedGraphAgent = graphAgents.find((agent) => agent.key === selectedAgentKey);
  const selectedAgentNode = selectedGraphAgent?.sourceAgent
    ? agentNodeByAgentId.get(selectedGraphAgent.sourceAgent.id)
    : selectedGraphAgent?.nodeId
      ? teamAgentNodes.find((candidate) => candidate.id === selectedGraphAgent.nodeId)
      : undefined;
  const selectedAgentDetail = selectedGraphAgent
    ? createAgentDetailModel({
        agent: selectedGraphAgent,
        tasks: graphTasks.filter((task) => task.ownerKey === selectedGraphAgent.key),
        artifacts: selectedGraphAgent.sourceAgent
          ? artifacts.filter((artifact) => artifact.agentId === selectedGraphAgent.sourceAgent?.id)
          : [],
        agentNode: selectedAgentNode,
        rootFolder,
      })
    : undefined;
  const agentTypeByOwnerKey = useMemo(
    () => new Map(graphAgents.map((agent) => [agent.key, agent.agentType])),
    [graphAgents],
  );

  const teamTitle = runtime?.team.name ?? data.agentTeamName ?? node.title;
  const teamCwd = lead?.cwd
    ?? metadataString(lead?.metadata, ['cwd'])
    ?? metadataString(lead?.sessionRef?.metadata, ['cwd'])
    ?? teammates.find((agent) => agent.cwd)?.cwd
    ?? metadataString(runtime?.team.metadata, ['cwd'])
    ?? rootFolder
    ?? '';
  const phaseTitle = phase === 'briefing'
    ? 'Briefing'
    : runtime?.team.status === 'completed'
      ? 'Completed'
      : isCheckpoint
        ? `Round ${checkpointRound ?? ''} Checkpoint`
        : phase === 'plan_review'
          ? 'Plan Review'
          : phase === 'starting'
            ? 'Starting Agents'
            : 'Executing';
  const doneTaskCount = tasks.filter((task) => task.status === 'done').length;
  const activeTaskCount = tasks.filter((task) =>
    task.status === 'in_progress'
    || task.status === 'needs_input'
    || task.status === 'needs_review'
  ).length;

  const handleConfirmPlan = controller.confirmPlan;
  const handleAdvanceRound = controller.advanceRound;
  const handleFinalizeCheckpoint = controller.finalizeCheckpoint;
  const handleUpdatePlanTeammate = controller.updatePlanTeammate;
  const handlePauseTeam = controller.pauseTeam;
  const handleResumeTeam = controller.resumeTeam;
  const handleDispatch = controller.dispatch;

  const handleDeleteTeam = async () => {
    const accepted = await confirm({
      intent: 'danger',
      title: `Delete Agent Team "${teamTitle}"?`,
      description:
        'This removes the Agent Team frame, Team Lead, teammates, and their Coding Agent nodes from the canvas. This action cannot be undone.',
      confirmLabel: 'Delete team',
    });
    if (!accepted) return;
    const deletedNodeIds = await controller.deleteTeam();
    if (deletedNodeIds?.length) onRemoveNodes?.(deletedNodeIds);
  };

  const handleAnswerGate = async (gateId: string) => {
    const answer = gateAnswers[gateId]?.trim();
    if (!answer || !(await controller.answerGate(gateId, answer))) return;
    setGateAnswers((current) => {
      const next = { ...current };
      delete next[gateId];
      return next;
    });
  };
  const leadNodeId = typeof lead?.metadata?.canvasNodeId === 'string'
    ? lead.metadata.canvasNodeId
    : typeof lead?.sessionRef?.metadata?.nodeId === 'string'
      ? lead.sessionRef.metadata.nodeId
      : undefined;
  const leadCurrentTask = lead?.currentTaskId ? taskById.get(lead.currentTaskId) : undefined;
  const graphTitle = phase === 'plan_review'
    ? 'Proposed task graph'
    : phase === 'starting'
      ? 'Starting task graph'
      : phase === 'executing'
        ? 'Live task graph'
        : 'Task graph';
  const edgeMarkerId = `agent-team-dag-arrow-${(teamId ?? node.id).replace(/[^\w-]/g, '-')}`;
  const graphSubtitle = phase === 'briefing'
    ? 'Brief Team Lead to generate a plan.'
    : phase === 'starting'
      ? 'Starting agent terminals before dispatching tasks.'
      : `${graphTasks.length} task${graphTasks.length === 1 ? '' : 's'} · ${graphAgents.length} teammate${graphAgents.length === 1 ? '' : 's'}`;

  const renderHumanGate = (gate: AgentTeamHumanGateRecord, options: { compact?: boolean } = {}) => (
    <HumanGateCard
      gate={gate}
      agent={gate.agentId ? agentById.get(gate.agentId) : undefined}
      task={gate.taskId ? taskById.get(gate.taskId) : undefined}
      graphTask={gate.taskId ? graphTaskByKey.get(gate.taskId) : undefined}
      selectedTaskId={selectedTask?.id}
      answer={gateAnswers[gate.id] ?? ''}
      compact={options.compact}
      readOnly={readOnly}
      onAnswerChange={(answer) => setGateAnswers((current) => ({ ...current, [gate.id]: answer }))}
      onAnswer={() => void handleAnswerGate(gate.id)}
      onViewTask={selection.selectGraphTask}
    />
  );

  const canPauseTeam = phase === 'executing'
    && teamStatus !== 'paused'
    && teamStatus !== 'completed'
    && teamStatus !== 'failed';
  const canResumeTeam = phase === 'executing' && teamStatus === 'paused';
  const canDispatch = phase === 'executing'
    && teamStatus === 'running'
    && tasks.some((task) => task.status === 'todo')
    && agents.some((agent) => agent.role === 'teammate' && agent.status === 'idle');
  const showGlobalGate = !!globalGate
    && !selectedHumanTaskGate
    && phase === 'executing'
    && isHumanFacingGate(globalGate);

  const renderTeamCommand = (placement: 'top' | 'lead' = 'top') => (
    <TeamCommand
      placement={placement}
      phase={phase}
      teamStatus={teamStatus}
      lead={lead}
      selectedTask={selectedTask}
      readOnly={readOnly}
      getAllNodes={getAllNodes}
      briefLead={controller.briefLead}
      sendInput={controller.sendInput}
    />
  );

  const renderAgentInspector = () => {
    if (!agentInspectorOpen || !selectedAgentDetail) return null;
    return (
      <AgentInspector
        detail={selectedAgentDetail}
        mode={agentInspectorMode}
        terminal={{ getAllNodes, rootFolder, workspaceId, workspaceName, onUpdate, readOnly }}
        onClose={selection.closeAgentInspector}
        onModeChange={selection.setAgentInspectorMode}
        onSelectTask={selection.selectGraphTask}
        onSelectArtifact={selection.selectArtifact}
      />
    );
  };

  if (!teamId) return <div className="frame-body" />;

  return (
    <div
      className={`agent-team-frame agent-team-frame--${phase}`}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <TeamHeader
        view={{
          title: teamTitle,
          phaseTitle,
          cwd: teamCwd,
          doneTaskCount,
          taskCount: tasks.length,
          activeTaskCount,
          phase,
          status: teamStatus,
          loading,
          error,
          readOnly,
          teamAction,
          planAction,
          checkpointRound,
          canPause: canPauseTeam,
          canResume: canResumeTeam,
          canDispatch,
        }}
        actions={{
          pause: () => void handlePauseTeam(),
          resume: () => void handleResumeTeam(),
          dispatch: () => void handleDispatch(),
          deleteTeam: () => void handleDeleteTeam(),
          advanceRound: () => void handleAdvanceRound(),
          finalizeCheckpoint: () => void handleFinalizeCheckpoint(),
        }}
      />

      <div className={`agent-team-workspace agent-team-workspace--${phase}`}>
        <LeadDock
          lead={lead}
          leadNode={leadCanvasNode}
          leadNodeId={leadNodeId}
          phase={phase}
          teamStatus={teamStatus}
          sessionHealth={lead ? snapshot?.sessions?.[lead.id] : undefined}
          currentTaskTitle={leadCurrentTask?.title}
          selectedTaskTitle={selectedGraphTask?.title}
          commandSlot={shouldShowLeadCommandSlot ? renderTeamCommand('lead') : undefined}
          terminal={{ getAllNodes, rootFolder, workspaceId, workspaceName, onUpdate, readOnly }}
        />
        <TaskWorkspace
          view={{
            markerId: edgeMarkerId,
            phase,
            graphTitle,
            graphSubtitle,
            rounds: graphRounds,
            roundOptions,
            agents: graphAgents,
            selectedTask: selectedGraphTask,
            selectedAgentKey,
            selectedAgentDetail,
            agentTypeByOwnerKey,
            detailMode: detailPanelMode,
            agentViewMode,
            taskArtifacts: selectedTaskArtifacts,
            taskGate: selectedHumanTaskGate && selectedGraphTask?.sourceTask
              ? renderHumanGate(selectedHumanTaskGate, { compact: true })
              : undefined,
            terminal: { getAllNodes, rootFolder, workspaceId, workspaceName, onUpdate, readOnly },
            readOnly,
            agentOptions: TEAM_AGENT_OPTIONS,
            planAvailable: !!plan,
            planIntegrationVerify: plan?.integrationVerify,
            planAction,
            isCheckpoint,
            checkpointRound,
          }}
          actions={{
            selectTask: selection.selectGraphTask,
            selectAgent: selection.selectGraphAgent,
            changeAgentType: (name, agentType) => void handleUpdatePlanTeammate(name, agentType),
            changeDetailMode: selection.setDetailPanelMode,
            changeAgentViewMode: selection.setAgentViewMode,
            expandAgent: selection.expandAgentInspector,
            selectArtifact: selection.selectArtifact,
            confirmPlan: handleConfirmPlan,
            advanceRound: () => void handleAdvanceRound(),
            finalizeCheckpoint: () => void handleFinalizeCheckpoint(),
          }}
        />
      </div>

      <RuntimeMounts
        nodes={teammateCanvasNodes}
        starting={phase === 'starting'}
        terminal={{ getAllNodes, rootFolder, workspaceId, workspaceName, onUpdate, readOnly }}
      />

      {showGlobalGate && globalGate && (
        renderHumanGate(globalGate)
      )}

      {renderAgentInspector()}

      {selectedArtifact && (
        <ArtifactViewer
          artifact={selectedArtifact}
          taskTitle={selectedArtifactTask?.title}
          agentName={selectedArtifactAgent?.name}
          readFile={window.canvasWorkspace?.file?.read}
          onClose={selection.closeArtifact}
        />
      )}
    </div>
  );
};
