import { useMemo } from 'react';
import type {
  AgentNodeData,
  AgentTeamAgentRecord,
  AgentTeamArtifactRecord,
  AgentTeamSnapshot,
  AgentTeamTaskRecord,
  CanvasNode,
  FrameNodeData,
} from '../../../../../types';
import {
  createAgentTeamGraphAgents,
  createAgentTeamWorkspaceModel,
} from '../../../model/workspaceModel';
import { createAgentDetailModel } from '../../AgentDetail';
import { hasConcreteHumanGatePrompt } from '../../HumanGateCard';
import { createAgentTeamFramePresentation } from '../presentation';
import { useAgentTeamFrameSelection } from '../useAgentTeamFrameSelection';

interface Options {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  rootFolder?: string;
  snapshot?: AgentTeamSnapshot | null;
}

const isTeamAgentNode = (
  node: CanvasNode,
  teamId: string,
): node is CanvasNode & { data: AgentNodeData } => (
  node.type === 'agent'
  && (node.data as AgentNodeData).agentTeamId === teamId
  && Boolean((node.data as AgentNodeData).agentTeamAgentId)
);

const isHumanFacingGate = (gate: AgentTeamSnapshot['runtime']['humanGates'][number]) => (
  gate.metadata?.audience !== 'lead' && hasConcreteHumanGatePrompt(gate.prompt)
);

export function useAgentTeamFrameModel({
  node,
  getAllNodes,
  rootFolder,
  snapshot,
}: Options) {
  const data = node.data as FrameNodeData;
  const teamId = data.agentTeamId;
  const runtime = snapshot?.runtime;
  const workspaceModel = useMemo(
    () => snapshot ? createAgentTeamWorkspaceModel(snapshot) : null,
    [snapshot],
  );
  const agents = workspaceModel?.agents ?? [];
  const tasks = runtime?.tasks ?? [];
  const artifacts = runtime?.artifacts ?? [];
  const openGates = (runtime?.humanGates ?? []).filter((gate) => gate.status === 'open');
  const teammates = workspaceModel?.teammates ?? [];
  const phase = workspaceModel?.phase ?? 'briefing';
  const plan = snapshot?.pendingPlan;
  const teamAgentNodes = teamId
    ? (getAllNodes?.() ?? []).filter((candidate) => isTeamAgentNode(candidate, teamId))
    : [];
  const agentNodeByAgentId = new Map(
    teamAgentNodes.map((agentNode) => [agentNode.data.agentTeamAgentId!, agentNode]),
  );
  const teammateCanvasNodes = teammates
    .map((agent) => agentNodeByAgentId.get(agent.id))
    .filter((agentNode): agentNode is CanvasNode & { data: AgentNodeData } => Boolean(agentNode));
  const agentById = workspaceModel?.agentById ?? new Map<string, AgentTeamAgentRecord>();
  const taskById = workspaceModel?.taskById ?? new Map<string, AgentTeamTaskRecord>();
  const artifactsByTask = workspaceModel?.artifactsByTask
    ?? new Map<string, AgentTeamArtifactRecord[]>();
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
  const presentation = createAgentTeamFramePresentation({
    nodeId: node.id,
    nodeTitle: node.title,
    teamId,
    data,
    runtime,
    phase,
    agents,
    teammates,
    graphTaskCount: graphTasks.length,
    graphAgentCount: graphAgents.length,
    rootFolder,
  });
  const leadCanvasNode = presentation.lead
    ? agentNodeByAgentId.get(presentation.lead.id)
    : undefined;
  const selection = useAgentTeamFrameSelection({
    phase,
    artifacts,
    graphTasks,
    graphAgents,
    orderedTasks: workspaceModel?.orderedTasks ?? [],
    taskById,
    defaultTask: workspaceModel?.defaultTask,
  });
  const selectedTaskArtifacts = selection.selectedTask
    ? artifactsByTask.get(selection.selectedTask.id) ?? []
    : [];
  const selectedTaskGate = selection.selectedTask
    ? openGates.find((gate) => gate.taskId === selection.selectedTask?.id)
    : undefined;
  const selectedHumanTaskGate = selectedTaskGate && isHumanFacingGate(selectedTaskGate)
    ? selectedTaskGate
    : undefined;
  const globalGate = openGates.find((gate) => (
    isHumanFacingGate(gate)
    && (!selection.selectedTask || gate.taskId !== selection.selectedTask.id)
  ));
  const selectedArtifactTask = selection.selectedArtifact?.taskId
    ? taskById.get(selection.selectedArtifact.taskId)
    : undefined;
  const selectedArtifactAgent = selection.selectedArtifact?.agentId
    ? agentById.get(selection.selectedArtifact.agentId)
    : undefined;
  const selectedGraphAgent = graphAgents.find(
    (agent) => agent.key === selection.selectedAgentKey,
  );
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

  return {
    teamId,
    runtime,
    tasks,
    artifacts,
    phase,
    plan,
    teammateCanvasNodes,
    leadCanvasNode,
    agentById,
    taskById,
    graphTasks,
    graphRounds,
    roundOptions,
    graphAgents,
    presentation,
    selection,
    selectedTaskArtifacts,
    selectedHumanTaskGate,
    globalGate,
    selectedArtifactTask,
    selectedArtifactAgent,
    selectedAgentDetail,
    agentTypeByOwnerKey,
    isHumanFacingGate,
  };
}
