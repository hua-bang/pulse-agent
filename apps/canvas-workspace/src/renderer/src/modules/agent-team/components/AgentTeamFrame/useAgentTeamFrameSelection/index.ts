import { useEffect, useMemo, useState } from 'react';
import type {
  AgentTeamArtifactRecord,
  AgentTeamPhase,
  AgentTeamTaskRecord,
} from '../../../../../types';
import type {
  AgentTeamGraphAgent,
  AgentTeamGraphTask,
} from '../../../model/workspaceModel';

type DetailMode = 'task' | 'agent';
type AgentViewMode = 'activity' | 'terminal';

interface Options {
  phase: AgentTeamPhase;
  artifacts: AgentTeamArtifactRecord[];
  graphTasks: AgentTeamGraphTask[];
  graphAgents: AgentTeamGraphAgent[];
  orderedTasks: AgentTeamTaskRecord[];
  taskById: ReadonlyMap<string, AgentTeamTaskRecord>;
  defaultTask?: AgentTeamTaskRecord;
}

export interface AgentTeamFrameSelection {
  graphTaskByKey: ReadonlyMap<string, AgentTeamGraphTask>;
  selectedTask?: AgentTeamTaskRecord;
  selectedGraphTask?: AgentTeamGraphTask;
  selectedArtifact?: AgentTeamArtifactRecord;
  selectedAgentKey: string;
  detailPanelMode: DetailMode;
  agentInspectorMode: AgentViewMode;
  agentViewMode: AgentViewMode;
  agentInspectorOpen: boolean;
  selectGraphTask: (task: AgentTeamGraphTask) => void;
  selectGraphAgent: (agent: AgentTeamGraphAgent) => void;
  setDetailPanelMode: (mode: DetailMode) => void;
  setAgentInspectorMode: (mode: AgentViewMode) => void;
  setAgentViewMode: (mode: AgentViewMode) => void;
  expandAgentInspector: () => void;
  closeAgentInspector: () => void;
  selectArtifact: (artifact: AgentTeamArtifactRecord) => void;
  closeArtifact: () => void;
}

export function useAgentTeamFrameSelection({
  phase,
  artifacts,
  graphTasks,
  graphAgents,
  orderedTasks,
  taskById,
  defaultTask,
}: Options): AgentTeamFrameSelection {
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedPlanTaskKey, setSelectedPlanTaskKey] = useState('');
  const [selectedArtifactId, setSelectedArtifactId] = useState('');
  const [selectedAgentKey, setSelectedAgentKey] = useState('');
  const [detailPanelMode, setDetailPanelMode] = useState<DetailMode>('task');
  const [agentInspectorMode, setAgentInspectorMode] = useState<AgentViewMode>('terminal');
  const [agentViewMode, setAgentViewMode] = useState<AgentViewMode>('activity');
  const [agentInspectorOpen, setAgentInspectorOpen] = useState(false);

  const graphTaskByKey = useMemo(
    () => new Map(graphTasks.map((task) => [task.key, task])),
    [graphTasks],
  );
  const selectedTask = taskById.get(selectedTaskId) ?? defaultTask;
  const selectedGraphTask = phase === 'plan_review'
    ? graphTaskByKey.get(selectedPlanTaskKey) ?? graphTasks[0]
    : selectedTask
      ? graphTaskByKey.get(selectedTask.id)
      : graphTasks[0];
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId);

  useEffect(() => {
    if (!selectedArtifactId || selectedArtifact) return;
    setSelectedArtifactId('');
  }, [selectedArtifact, selectedArtifactId]);

  useEffect(() => {
    if (phase !== 'plan_review') {
      if (selectedPlanTaskKey) setSelectedPlanTaskKey('');
      return;
    }
    if (graphTasks.length === 0) return;
    if (selectedPlanTaskKey && graphTaskByKey.has(selectedPlanTaskKey)) return;
    setSelectedPlanTaskKey(graphTasks[0].key);
  }, [graphTaskByKey, graphTasks, phase, selectedPlanTaskKey]);

  useEffect(() => {
    if (!selectedAgentKey || graphAgents.some((agent) => agent.key === selectedAgentKey)) return;
    setSelectedAgentKey('');
    setDetailPanelMode('task');
    setAgentInspectorOpen(false);
  }, [graphAgents, selectedAgentKey]);

  useEffect(() => {
    setAgentInspectorMode('terminal');
    setAgentViewMode('terminal');
  }, [selectedAgentKey]);

  useEffect(() => {
    if (orderedTasks.length === 0) {
      if (selectedTaskId) setSelectedTaskId('');
      return;
    }
    if (selectedTaskId && taskById.has(selectedTaskId)) return;
    setSelectedTaskId(defaultTask?.id ?? orderedTasks[0].id);
  }, [defaultTask, orderedTasks, selectedTaskId, taskById]);

  return {
    graphTaskByKey,
    selectedTask,
    selectedGraphTask,
    selectedArtifact,
    selectedAgentKey,
    detailPanelMode,
    agentInspectorMode,
    agentViewMode,
    agentInspectorOpen,
    selectGraphTask: (task) => {
      if (task.sourceTask) setSelectedTaskId(task.sourceTask.id);
      else setSelectedPlanTaskKey(task.key);
      setSelectedAgentKey(task.ownerKey ?? '');
      setDetailPanelMode('task');
    },
    selectGraphAgent: (agent) => {
      setSelectedAgentKey(agent.key);
      setDetailPanelMode('agent');
    },
    setDetailPanelMode,
    setAgentInspectorMode,
    setAgentViewMode,
    expandAgentInspector: () => {
      setAgentInspectorMode(agentViewMode);
      setAgentInspectorOpen(true);
    },
    closeAgentInspector: () => setAgentInspectorOpen(false),
    selectArtifact: (artifact) => setSelectedArtifactId(artifact.id),
    closeArtifact: () => setSelectedArtifactId(''),
  };
}
