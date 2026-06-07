import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import { AgentNodeBody } from '../AgentNodeBody';
import type {
  AgentNodeData,
  AgentTeamAgentRecord,
  AgentTeamArtifactRecord,
  AgentTeamHumanGateRecord,
  AgentTeamPhase,
  AgentTeamSnapshot,
  AgentTeamTaskRecord,
  CanvasNode,
  FrameNodeData,
} from '../../types';

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

const TASK_STATUS_LABELS: Record<string, string> = {
  proposed: 'Proposed',
  planned: 'Planned',
  todo: 'Todo',
  in_progress: 'Running',
  needs_input: 'Needs input',
  needs_review: 'Needs review',
  blocked: 'Blocked',
  done: 'Done',
  failed: 'Failed',
};

const TASK_STATUS_RANK: Record<string, number> = {
  proposed: 0,
  needs_input: 0,
  in_progress: 1,
  needs_review: 2,
  blocked: 3,
  todo: 4,
  done: 5,
  failed: 6,
};

const statusLabel = (status: string) =>
  TASK_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');

const inferPhase = (
  explicit: AgentTeamPhase | undefined,
  teammates: AgentTeamAgentRecord[],
  tasks: AgentTeamTaskRecord[],
  teamStatus?: string,
): AgentTeamPhase => {
  if (explicit) return explicit;
  if (teamStatus === 'waiting_approval') return 'plan_review';
  if (teammates.length > 0 || tasks.length > 0) return 'executing';
  return 'briefing';
};

const taskStatusRank = (task: AgentTeamTaskRecord) =>
  TASK_STATUS_RANK[task.status] ?? 99;

const shortText = (value: string | undefined, fallback: string) =>
  value?.trim() || fallback;

const artifactLabel = (artifact: AgentTeamArtifactRecord) =>
  artifact.title || artifact.uri || artifact.kind;

const artifactFilePath = (artifact: AgentTeamArtifactRecord): string | undefined => {
  const uri = artifact.uri?.trim();
  if (!uri) return undefined;
  if (uri.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(uri).pathname);
    } catch {
      return uri.slice('file://'.length);
    }
  }
  return uri.startsWith('/') ? uri : undefined;
};

const DOWNSTREAM_TASK_RE = /(qa|test|测试|验收|验证|联调|review|审核|文档|document|summary|总结|release|发布|交付)/i;

const isLikelyDownstreamPlanTask = (task: { title: string; description: string }) =>
  DOWNSTREAM_TASK_RE.test(`${task.title} ${task.description}`);

const graphKeyFromTitle = (title: string) => title.trim().toLowerCase();

const hasConcreteHumanGatePrompt = (prompt: string): boolean => {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (/^agent requested human input\.?$/i.test(normalized)) return false;
  if (/^human input requested\.?$/i.test(normalized)) return false;
  return true;
};

const isHumanFacingGate = (gate: AgentTeamHumanGateRecord): boolean =>
  gate.metadata?.audience !== 'lead' && hasConcreteHumanGatePrompt(gate.prompt);

const terminalLineText = (value: string): string =>
  value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/[│┃╭╮╰╯┌┐└┘├┤┬┴┼─━═]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isLowSignalTerminalLine = (value: string): boolean =>
  !value
  || /^gpt-[\w.-]+/i.test(value)
  || /^>\s*(write tests|explain this codebase|find and fix)/i.test(value)
  || /^\.\.\. \+\d+ lines/i.test(value)
  || /^\+\d+ lines/i.test(value)
  || /^working\b/i.test(value)
  || /^messages to be submitted/i.test(value);

const recentTerminalLines = (scrollback: string | undefined, limit = 8): string[] => {
  if (!scrollback) return [];
  const seen = new Set<string>();
  return scrollback
    .split('\n')
    .map(terminalLineText)
    .filter((line) => !isLowSignalTerminalLine(line))
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .slice(-limit);
};

const isTeamAgentNode = (node: CanvasNode, teamId: string): node is CanvasNode & { data: AgentNodeData } =>
  node.type === 'agent'
  && (node.data as AgentNodeData).agentTeamId === teamId
  && !!(node.data as AgentNodeData).agentTeamAgentId;

const metadataNumber = (
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined => {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
};

interface GraphTaskItem {
  key: string;
  title: string;
  description: string;
  status: string;
  ownerName: string;
  ownerKey?: string;
  depKeys: string[];
  depLabels: string[];
  artifactCount: number;
  updatedAt?: number;
  result?: string;
  blockedReason?: string;
  sourceTask?: AgentTeamTaskRecord;
  dependencyWarning?: boolean;
}

interface GraphAgentItem {
  key: string;
  name: string;
  role: 'lead' | 'teammate';
  agentType?: string;
  status: string;
  taskCount: number;
  doneCount: number;
  runningCount: number;
  blockedCount: number;
  artifactCount: number;
  toolCount?: number;
  currentTaskTitle?: string;
  nodeId?: string;
  sourceAgent?: AgentTeamAgentRecord;
}

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
  const [snapshot, setSnapshot] = useState<AgentTeamSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [teamAction, setTeamAction] = useState<'pause' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefDraft, setBriefDraft] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskOwner, setTaskOwner] = useState('');
  const [gateAnswers, setGateAnswers] = useState<Record<string, string>>({});
  const [selectedArtifactId, setSelectedArtifactId] = useState('');
  const [selectedAgentKey, setSelectedAgentKey] = useState('');
  const [agentInspectorMode, setAgentInspectorMode] = useState<'activity' | 'terminal'>('activity');
  const [selectedPlanTaskKey, setSelectedPlanTaskKey] = useState('');
  const [artifactPreview, setArtifactPreview] = useState<{
    artifactId: string;
    content?: string;
    error?: string;
    loading: boolean;
  } | null>(null);
  const commandRef = useRef<HTMLTextAreaElement>(null);

  const api = window.canvasWorkspace?.agentTeams;
  const runtime = snapshot?.runtime;
  const agents = runtime?.agents ?? [];
  const tasks = runtime?.tasks ?? [];
  const gates = runtime?.humanGates ?? [];
  const artifacts = runtime?.artifacts ?? [];
  const openGates = gates.filter((gate) => gate.status === 'open');
  const lead = useMemo(() => agents.find((agent) => agent.role === 'lead'), [agents]);
  const teammates = useMemo(() => agents.filter((agent) => agent.role !== 'lead'), [agents]);
  const phase = inferPhase(snapshot?.phase, teammates, tasks, runtime?.team.status);
  const plan = snapshot?.pendingPlan;
  const teamAgentNodes = teamId
    ? (getAllNodes?.() ?? []).filter((candidate) => isTeamAgentNode(candidate, teamId))
    : [];
  const agentNodeByAgentId = new Map(
    teamAgentNodes.map((agentNode) => [agentNode.data.agentTeamAgentId, agentNode]),
  );
  const leadCanvasNode = lead ? agentNodeByAgentId.get(lead.id) : undefined;
  const teammateCanvasNodes = teammates
    .map((agent) => agentNodeByAgentId.get(agent.id))
    .filter((agentNode): agentNode is CanvasNode & { data: AgentNodeData } => !!agentNode);

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const artifactsByTask = useMemo(() => {
    const grouped = new Map<string, AgentTeamArtifactRecord[]>();
    for (const artifact of artifacts) {
      if (!artifact.taskId) continue;
      grouped.set(artifact.taskId, [...(grouped.get(artifact.taskId) ?? []), artifact]);
    }
    return grouped;
  }, [artifacts]);
  const orderedTasks = useMemo(
    () => [...tasks].sort((a, b) => taskStatusRank(a) - taskStatusRank(b) || a.createdAt - b.createdAt),
    [tasks],
  );
  const defaultTask = useMemo(
    () => orderedTasks.find((task) => task.status !== 'done' && task.status !== 'failed') ?? orderedTasks[0],
    [orderedTasks],
  );
  const selectedTask = useMemo(
    () => taskById.get(selectedTaskId) ?? defaultTask,
    [defaultTask, selectedTaskId, taskById],
  );
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
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId),
    [artifacts, selectedArtifactId],
  );
  const selectedArtifactTask = selectedArtifact?.taskId ? taskById.get(selectedArtifact.taskId) : undefined;
  const selectedArtifactAgent = selectedArtifact?.agentId ? agentById.get(selectedArtifact.agentId) : undefined;
  const graphTasks = useMemo<GraphTaskItem[]>(() => {
    if (phase === 'plan_review' && plan) {
      return plan.tasks.map((task) => {
        const key = graphKeyFromTitle(task.title);
        return {
          key,
          title: task.title,
          description: task.description,
          status: 'proposed',
          ownerName: task.ownerName ?? 'Unassigned',
          ownerKey: task.ownerName ? `plan:${graphKeyFromTitle(task.ownerName)}` : undefined,
          depKeys: task.deps.map(graphKeyFromTitle),
          depLabels: task.deps,
          artifactCount: 0,
          updatedAt: plan.updatedAt,
          dependencyWarning: task.deps.length === 0 && isLikelyDownstreamPlanTask(task),
        };
      });
    }

    return orderedTasks.map((task) => {
      const owner = task.ownerAgentId ? agentById.get(task.ownerAgentId) : undefined;
      const taskArtifacts = artifactsByTask.get(task.id) ?? [];
      return {
        key: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        ownerName: owner?.name ?? 'Any teammate',
        ownerKey: owner ? `agent:${owner.id}` : undefined,
        depKeys: task.deps,
        depLabels: task.deps.map((depId) => taskById.get(depId)?.title ?? depId),
        artifactCount: taskArtifacts.length,
        updatedAt: task.updatedAt,
        result: task.result,
        blockedReason: task.blockedReason,
        sourceTask: task,
      };
    });
  }, [agentById, artifactsByTask, orderedTasks, phase, plan, taskById]);
  const graphTaskByKey = useMemo(
    () => new Map(graphTasks.map((task) => [task.key, task])),
    [graphTasks],
  );
  const graphColumns = useMemo(() => {
    const depthCache = new Map<string, number>();
    const getDepth = (task: GraphTaskItem, seen = new Set<string>()): number => {
      const cached = depthCache.get(task.key);
      if (cached !== undefined) return cached;
      if (seen.has(task.key)) return 0;
      const nextSeen = new Set(seen).add(task.key);
      const depths = task.depKeys
        .map((depKey) => graphTaskByKey.get(depKey))
        .filter((dep): dep is GraphTaskItem => !!dep)
        .map((dep) => getDepth(dep, nextSeen) + 1);
      const depth = depths.length > 0 ? Math.max(...depths) : 0;
      depthCache.set(task.key, depth);
      return depth;
    };

    const columns: GraphTaskItem[][] = [];
    for (const task of graphTasks) {
      const depth = getDepth(task);
      if (!columns[depth]) columns[depth] = [];
      columns[depth].push(task);
    }
    return columns.filter(Boolean);
  }, [graphTaskByKey, graphTasks]);
  const selectedGraphTask = useMemo(() => {
    if (phase === 'plan_review') {
      return graphTaskByKey.get(selectedPlanTaskKey) ?? graphTasks[0];
    }
    return selectedTask ? graphTaskByKey.get(selectedTask.id) : graphTasks[0];
  }, [graphTaskByKey, graphTasks, phase, selectedPlanTaskKey, selectedTask]);
  const graphAgents = useMemo<GraphAgentItem[]>(() => {
    if (phase === 'plan_review' && plan) {
      return plan.teammates.map((teammate) => {
        const ownerKey = `plan:${graphKeyFromTitle(teammate.name)}`;
        const ownedTasks = graphTasks.filter((task) => task.ownerKey === ownerKey);
        return {
          key: ownerKey,
          name: teammate.name,
          role: 'teammate',
          agentType: teammate.agentType ?? 'agent',
          status: 'planned',
          taskCount: ownedTasks.length,
          doneCount: 0,
          runningCount: 0,
          blockedCount: 0,
          artifactCount: 0,
          currentTaskTitle: ownedTasks[0]?.title,
        };
      });
    }

    return teammates.map((agent) => {
      const ownedTasks = graphTasks.filter((task) => task.ownerKey === `agent:${agent.id}`);
      const currentTask = agent.currentTaskId
        ? graphTaskByKey.get(agent.currentTaskId)
        : ownedTasks.find((task) => task.status === 'in_progress' || task.status === 'needs_input' || task.status === 'needs_review')
          ?? ownedTasks.find((task) => task.status !== 'done' && task.status !== 'failed')
          ?? ownedTasks[0];
      const agentArtifacts = artifacts.filter((artifact) => artifact.agentId === agent.id);
      return {
        key: `agent:${agent.id}`,
        name: agent.name,
        role: agent.role,
        agentType: agent.sessionRef?.provider ?? agent.sessionRef?.displayName,
        status: agent.status,
        taskCount: ownedTasks.length,
        doneCount: ownedTasks.filter((task) => task.status === 'done').length,
        runningCount: ownedTasks.filter((task) => task.status === 'in_progress').length,
        blockedCount: ownedTasks.filter((task) => task.status === 'blocked').length,
        artifactCount: agentArtifacts.length,
        toolCount: metadataNumber(agent.metadata, ['toolCount', 'toolCalls', 'toolsUsed']),
        currentTaskTitle: currentTask?.title,
        nodeId: typeof agent.metadata?.canvasNodeId === 'string'
          ? agent.metadata.canvasNodeId
          : typeof agent.sessionRef?.metadata?.nodeId === 'string'
            ? agent.sessionRef.metadata.nodeId
            : undefined,
        sourceAgent: agent,
      };
    });
  }, [artifacts, graphTaskByKey, graphTasks, phase, plan, teammates]);
  const selectedGraphAgent = graphAgents.find((agent) => agent.key === selectedAgentKey);

  const teamTitle = runtime?.team.name ?? data.agentTeamName ?? node.title;
  const phaseTitle = phase === 'briefing'
    ? 'Briefing'
    : runtime?.team.status === 'completed'
      ? 'Completed'
      : phase === 'plan_review'
        ? 'Plan Review'
        : 'Executing';

  useEffect(() => {
    if (!selectedArtifactId || artifacts.some((artifact) => artifact.id === selectedArtifactId)) return;
    setSelectedArtifactId('');
    setArtifactPreview(null);
  }, [artifacts, selectedArtifactId]);

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
  }, [graphAgents, selectedAgentKey]);

  useEffect(() => {
    setAgentInspectorMode('activity');
  }, [selectedAgentKey]);

  useEffect(() => {
    if (!selectedArtifact) return;
    const path = artifactFilePath(selectedArtifact);
    if (!path || !window.canvasWorkspace?.file?.read) {
      setArtifactPreview({ artifactId: selectedArtifact.id, loading: false });
      return;
    }

    let cancelled = false;
    setArtifactPreview({ artifactId: selectedArtifact.id, loading: true });
    void window.canvasWorkspace.file.read(path).then((result) => {
      if (cancelled) return;
      setArtifactPreview({
        artifactId: selectedArtifact.id,
        content: result.ok ? result.content : undefined,
        error: result.ok ? undefined : result.error ?? 'Unable to read artifact file.',
        loading: false,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [selectedArtifact]);

  useEffect(() => {
    if (orderedTasks.length === 0) {
      if (selectedTaskId) setSelectedTaskId('');
      return;
    }
    if (selectedTaskId && taskById.has(selectedTaskId)) return;
    setSelectedTaskId(defaultTask?.id ?? orderedTasks[0].id);
  }, [defaultTask, orderedTasks, selectedTaskId, taskById]);

  const refresh = useCallback(async () => {
    if (!api || !workspaceId || !teamId) return;
    setLoading(true);
    const result = await api.snapshot(workspaceId, teamId);
    setLoading(false);
    if (!result.ok || !result.snapshot) {
      setError(result.error ?? 'Unable to load team.');
      return;
    }
    setError(null);
    setSnapshot(result.snapshot);
  }, [api, workspaceId, teamId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleBriefLead = useCallback(async () => {
    const content = briefDraft.trim();
    if (!api || !workspaceId || !teamId || !content) return;
    const result = await api.briefLead(workspaceId, teamId, content);
    if (result.ok && result.snapshot) {
      setSnapshot(result.snapshot);
      setBriefDraft('');
      setError(null);
    } else {
      setError(result.error ?? 'Unable to brief the leader.');
    }
  }, [api, workspaceId, teamId, briefDraft]);

  const handleConfirmPlan = useCallback(async () => {
    if (!api || !workspaceId || !teamId) return;
    const result = await api.confirmPlan(workspaceId, teamId);
    if (result.ok && result.snapshot) {
      setSnapshot(result.snapshot);
      setTaskFormOpen(false);
      setError(null);
    } else {
      setError(result.error ?? 'Unable to confirm plan.');
    }
  }, [api, workspaceId, teamId]);

  const handleTeamCommand = useCallback(async () => {
    if (phase === 'briefing') {
      await handleBriefLead();
      return;
    }

    const content = messageDraft.trim();
    if (!api || !workspaceId || !teamId || !lead || !content) return;
    const taskContext = selectedTask
      ? `Task context: "${selectedTask.title}" (${selectedTask.status}).\n`
      : '';
    const result = await api.sendInput(workspaceId, teamId, lead.id, `${taskContext}${content}`);
    if (result.ok && result.snapshot) {
      setSnapshot(result.snapshot);
      setMessageDraft('');
      setError(null);
    } else {
      setError(result.error ?? 'Unable to send command.');
    }
  }, [api, handleBriefLead, lead, messageDraft, phase, selectedTask, teamId, workspaceId]);

  const handleCreateTask = useCallback(async () => {
    if (!api || !workspaceId || !teamId || !taskTitle.trim() || !taskDescription.trim()) return;
    const result = await api.createTask({
      workspaceId,
      teamId,
      title: taskTitle.trim(),
      description: taskDescription.trim(),
      ownerAgentId: taskOwner || undefined,
    });
    if (!result.ok) {
      setError(result.error ?? 'Task creation failed.');
      return;
    }
    setTaskTitle('');
    setTaskDescription('');
    setTaskOwner('');
    setTaskFormOpen(false);
    const dispatchResult = await api.dispatch(workspaceId, teamId);
    if (dispatchResult.ok && dispatchResult.snapshot) {
      setSnapshot(dispatchResult.snapshot);
      setError(null);
    } else {
      await refresh();
    }
  }, [api, workspaceId, teamId, taskTitle, taskDescription, taskOwner, refresh]);

  const handlePauseTeam = useCallback(async () => {
    if (!api || !workspaceId || !teamId) return;
    setTeamAction('pause');
    const result = await api.pause(workspaceId, teamId);
    setTeamAction(null);
    if (result.ok && result.snapshot) {
      setSnapshot(result.snapshot);
      setError(null);
    } else {
      setError(result.error ?? 'Unable to pause the Agent Team.');
    }
  }, [api, workspaceId, teamId]);

  const handleDeleteTeam = useCallback(async () => {
    if (!api || !workspaceId || !teamId) return;
    const accepted = window.confirm([
      `Delete Agent Team "${teamTitle}"?`,
      'This removes the Agent Team frame, Team Lead, teammates, and their Coding Agent nodes from the canvas.',
      'This action cannot be undone.',
    ].join('\n\n'));
    if (!accepted) return;

    setTeamAction('delete');
    const result = await api.delete(workspaceId, teamId);
    setTeamAction(null);
    if (result.ok) {
      if (result.deletedNodeIds?.length) {
        onRemoveNodes?.(result.deletedNodeIds);
      }
      setSnapshot(null);
      setError(null);
    } else {
      setError(result.error ?? 'Unable to delete the Agent Team.');
    }
  }, [api, onRemoveNodes, teamId, teamTitle, workspaceId]);

  const handleAnswerGate = useCallback(async (gateId: string) => {
    if (!api || !workspaceId) return;
    const answer = gateAnswers[gateId]?.trim();
    if (!answer) return;
    const result = await api.answerGate(workspaceId, gateId, answer);
    if (result.ok && result.snapshot) {
      setSnapshot(result.snapshot);
      setGateAnswers((current) => {
        const next = { ...current };
        delete next[gateId];
        return next;
      });
    } else {
      setError(result.error ?? 'Unable to answer gate.');
    }
  }, [api, workspaceId, gateAnswers]);

  const leadNodeId = typeof lead?.metadata?.canvasNodeId === 'string'
    ? lead.metadata.canvasNodeId
    : typeof lead?.sessionRef?.metadata?.nodeId === 'string'
      ? lead.sessionRef.metadata.nodeId
      : undefined;
  const leadCurrentTask = lead?.currentTaskId ? taskById.get(lead.currentTaskId) : undefined;
  const graphTitle = phase === 'plan_review'
    ? 'Proposed task graph'
    : phase === 'executing'
      ? 'Live task graph'
      : 'Task graph';
  const graphSubtitle = phase === 'briefing'
    ? 'Brief Team Lead to generate a plan.'
    : `${graphTasks.length} task${graphTasks.length === 1 ? '' : 's'} · ${graphAgents.length} teammate${graphAgents.length === 1 ? '' : 's'}`;

  const selectGraphTask = (task: GraphTaskItem) => {
    if (task.sourceTask) setSelectedTaskId(task.sourceTask.id);
    else setSelectedPlanTaskKey(task.key);
    setSelectedAgentKey(task.ownerKey ?? '');
  };

  const ownerChipClass = (ownerKey?: string) =>
    `agent-team-owner-chip${ownerKey && selectedAgentKey === ownerKey ? ' agent-team-owner-chip--active' : ''}`;

  const renderHumanGate = (
    gate: AgentTeamHumanGateRecord,
    options: { compact?: boolean } = {},
  ) => {
    const gateAgent = gate.agentId ? agentById.get(gate.agentId) : undefined;
    const gateTask = gate.taskId ? taskById.get(gate.taskId) : undefined;
    const gateGraphTask = gate.taskId ? graphTaskByKey.get(gate.taskId) : undefined;
    const hasPrompt = hasConcreteHumanGatePrompt(gate.prompt);
    const displayedPrompt = hasPrompt
      ? gate.prompt
      : 'This agent asked for help but did not include a concrete question.';
    const reason = gate.reason?.trim();
    const showReason = !!reason && reason !== gate.prompt && !/^agent requested human input\.?$/i.test(reason);

    return (
      <div className={`agent-team-human-gate${options.compact ? ' agent-team-human-gate--compact' : ''}${hasPrompt ? '' : ' agent-team-human-gate--missing-prompt'}`}>
        <div className="agent-team-human-gate__copy">
          <span className="agent-team-detail__section-title">Needs input</span>
          <strong>{displayedPrompt}</strong>
          <span className="agent-team-human-gate__meta">
            {gateAgent ? `From ${gateAgent.name}` : 'From teammate'}
            {gateTask ? ` · Task: ${gateTask.title}` : ''}
            {showReason ? ` · ${reason}` : ''}
          </span>
          {!hasPrompt && (
            <span className="agent-team-human-gate__hint">
              No actionable question was provided. Ask the owner to clarify or send a team command with the missing decision.
            </span>
          )}
        </div>
        <div className="agent-team-human-gate__actions">
          {gateGraphTask && selectedTask?.id !== gate.taskId && (
            <button type="button" onClick={() => selectGraphTask(gateGraphTask)}>
              View task
            </button>
          )}
          <input
            value={gateAnswers[gate.id] ?? ''}
            onChange={(event) => setGateAnswers((current) => ({ ...current, [gate.id]: event.target.value }))}
            placeholder={hasPrompt ? 'Answer this question' : 'Optional clarification'}
            disabled={readOnly}
          />
          <button
            type="button"
            onClick={() => void handleAnswerGate(gate.id)}
            disabled={readOnly || !gateAnswers[gate.id]?.trim()}
          >
            Answer
          </button>
        </div>
      </div>
    );
  };

  const commandDraft = phase === 'briefing' ? briefDraft : messageDraft;
  const commandPlaceholder = phase === 'briefing'
    ? 'Describe the outcome, repo path, constraints, and what this team should handle...'
    : 'Tell Team Lead what to change...';
  const canSendCommand = phase === 'briefing'
    ? !!briefDraft.trim()
    : !!messageDraft.trim() && !!lead;
  const teamStatus = runtime?.team.status ?? 'planning';
  const canPauseTeam = phase === 'executing'
    && teamStatus !== 'paused'
    && teamStatus !== 'completed'
    && teamStatus !== 'failed';
  const showGlobalGate = !!globalGate
    && !selectedHumanTaskGate
    && phase === 'executing'
    && isHumanFacingGate(globalGate);

  const renderTeamCommand = (placement: 'top' | 'lead' = 'top') => (
    <div className={`agent-team-command agent-team-command--${placement}`} aria-label="Team command">
      <div className="agent-team-command__copy">
        <span className="agent-team-command__label">
          {phase === 'briefing' ? 'Brief Team Lead' : 'Team command'}
        </span>
        {phase === 'executing' && selectedTask && (
          <span className={`agent-team-command__task-chip agent-team-command__task-chip--${selectedTask.status}`}>
            Task · {selectedTask.title}
          </span>
        )}
        <textarea
          ref={commandRef}
          value={commandDraft}
          onChange={(event) => {
            if (phase === 'briefing') setBriefDraft(event.target.value);
            else setMessageDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            const sendBrief = phase === 'briefing' && event.key === 'Enter' && (event.metaKey || event.ctrlKey);
            const sendCommand = phase !== 'briefing' && event.key === 'Enter' && !event.shiftKey;
            if (sendBrief || sendCommand) {
              event.preventDefault();
              void handleTeamCommand();
            }
          }}
          placeholder={commandPlaceholder}
          disabled={readOnly}
          rows={phase === 'briefing' ? 8 : 1}
        />
      </div>
      <button type="button" onClick={() => void handleTeamCommand()} disabled={readOnly || !canSendCommand}>
        {phase === 'briefing' ? 'Brief' : 'Send'}
      </button>
    </div>
  );

  const renderLeadDock = () => (
    <section className="agent-team-lead-dock" aria-label="Team Lead">
      <div className="agent-team-lead-dock__head">
        <span className="agent-team-panel-heading__label">Team Lead</span>
        <strong>{lead?.name ?? 'Team Lead'}</strong>
        <span className={`agent-team-detail__status agent-team-detail__status--${lead?.status ?? 'idle'}`}>
          {statusLabel(lead?.status ?? 'idle')}
        </span>
      </div>

      <div className="agent-team-lead-dock__body">
        {leadCanvasNode ? (
          <div className="agent-team-lead-dock__agent-surface">
            <AgentNodeBody
              node={leadCanvasNode}
              getAllNodes={getAllNodes}
              rootFolder={rootFolder}
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              teamLeadBriefSlot={phase === 'briefing' ? renderTeamCommand('lead') : undefined}
              onUpdate={onUpdate}
              readOnly={readOnly}
            />
          </div>
        ) : (
          <>
            <div className="agent-team-lead-dock__current">
              <span className="agent-team-detail__section-title">Current focus</span>
              <strong>
                {phase === 'briefing'
                  ? 'Clarify scope and propose a plan'
                  : leadCurrentTask?.title ?? selectedGraphTask?.title ?? 'Coordinate team execution'}
              </strong>
              <span>
                {phase === 'plan_review'
                  ? 'Review the graph, ask for changes, then approve when the team split looks right.'
                  : phase === 'executing'
                    ? 'Use the command bar for normal changes. Ask the lead to route work to the right teammate.'
                    : 'Tell the lead what outcome, repo path, constraints, and teammate split you expect.'}
              </span>
            </div>

            <div className="agent-team-lead-dock__meta">
              <span>Provider</span>
              <strong>{lead?.sessionRef?.displayName ?? lead?.sessionRef?.provider ?? 'Coding Agent'}</strong>
              {leadNodeId && <code>{leadNodeId}</code>}
            </div>

            <button
              type="button"
              className="agent-team-lead-dock__command"
              onClick={() => commandRef.current?.focus()}
              disabled={readOnly}
            >
              Message Team Lead
            </button>
          </>
        )}
      </div>
    </section>
  );

  const renderTaskGraph = () => (
    <section className="agent-team-graph-panel" aria-label="Task Graph">
      <div className="agent-team-graph-panel__head">
        <div>
          <span className="agent-team-panel-heading__label">{graphTitle}</span>
          <strong>{graphSubtitle}</strong>
        </div>
        <div className="agent-team-graph-panel__actions">
          {phase === 'plan_review' && plan && (
            <button type="button" className="agent-team-frame__primary-action" onClick={handleConfirmPlan} disabled={readOnly}>
              Approve & Run
            </button>
          )}
          {phase === 'executing' && (
            <button type="button" onClick={() => setTaskFormOpen((open) => !open)} disabled={readOnly}>
              {taskFormOpen ? 'Close task form' : 'Add task'}
            </button>
          )}
        </div>
      </div>

      <div className={`agent-team-graph-panel__main${selectedGraphTask ? '' : ' agent-team-graph-panel__main--graph-only'}`}>
        <div className="agent-team-task-graph" aria-label="Task dependency graph">
          {graphColumns.length === 0 ? (
            <div className="agent-team-graph-empty">
              <span className="agent-team-empty-panel__eyebrow">No graph yet</span>
              <strong>Waiting for Team Lead to propose tasks.</strong>
              <span>The graph appears after the lead submits a plan.</span>
            </div>
          ) : graphColumns.map((column, columnIndex) => (
            <div key={columnIndex} className="agent-team-task-graph__column">
              <span className="agent-team-task-graph__stage">
                <span className="agent-team-task-graph__stage-index">{columnIndex + 1}</span>
                {columnIndex === 0 ? 'Start' : `Stage ${columnIndex + 1}`}
              </span>
              {column.map((task) => {
                const selected = selectedGraphTask?.key === task.key;
                const ownerHighlighted = !!selectedAgentKey && task.ownerKey === selectedAgentKey;
                const visibleDeps = task.depLabels.slice(0, 2);
                const hiddenDepCount = Math.max(0, task.depLabels.length - visibleDeps.length);
                return (
                  <button
                    key={task.key}
                    type="button"
                    className={`agent-team-graph-task agent-team-graph-task--${task.status}${selected ? ' agent-team-graph-task--selected' : ''}${ownerHighlighted ? ' agent-team-graph-task--owner-highlight' : ''}${task.dependencyWarning ? ' agent-team-graph-task--warning' : ''}`}
                    onClick={() => selectGraphTask(task)}
                  >
                    <span className={`agent-team-task-row__dot agent-team-task-row__dot--${task.status}`} />
                    <span className="agent-team-graph-task__copy">
                      <strong>{task.title}</strong>
                      <span className="agent-team-graph-task__meta">
                        <span>{statusLabel(task.status)}</span>
                        <span className={ownerChipClass(task.ownerKey)}>{task.ownerName}</span>
                      </span>
                    </span>
                    <span className="agent-team-graph-task__deps">
                      {visibleDeps.length > 0 ? visibleDeps.map((dep) => (
                        <span key={dep}>after {dep}</span>
                      )) : (
                        <span>entry task</span>
                      )}
                      {hiddenDepCount > 0 && (
                        <span>+{hiddenDepCount} deps</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {selectedGraphTask && (
          <aside className="agent-team-graph-detail" aria-label="Selected task detail">
            <>
              <div className="agent-team-graph-detail__head">
                <div>
                  <span className="agent-team-panel-heading__label">Selected task</span>
                  <strong>{selectedGraphTask.title}</strong>
                </div>
                <span className={`agent-team-detail__status agent-team-detail__status--${selectedGraphTask.status}`}>
                  {statusLabel(selectedGraphTask.status)}
                </span>
              </div>
              <div className="agent-team-detail__facts">
                <div>
                  <span className="agent-team-detail__section-title">Owner</span>
                  <span className={ownerChipClass(selectedGraphTask.ownerKey)}>{selectedGraphTask.ownerName}</span>
                </div>
                <div>
                  <span className="agent-team-detail__section-title">Updated</span>
                  <strong>
                    {selectedGraphTask.updatedAt
                      ? new Date(selectedGraphTask.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : 'Not yet'}
                  </strong>
                </div>
              </div>
              <div className="agent-team-detail__description">
                {shortText(selectedGraphTask.description, 'No task instructions yet.')}
              </div>
              <div className="agent-team-detail__grid">
                <div className="agent-team-detail__section">
                  <span className="agent-team-detail__section-title">Dependencies</span>
                  {selectedGraphTask.depLabels.length === 0 ? (
                    <span className="agent-team-detail__muted">None</span>
                  ) : selectedGraphTask.depLabels.map((dep) => (
                    <span key={dep} className="agent-team-detail__pill">{dep}</span>
                  ))}
                </div>
                <div className="agent-team-detail__section">
                  <span className="agent-team-detail__section-title">Artifacts</span>
                  {selectedGraphTask.sourceTask && selectedTaskArtifacts.length > 0 ? selectedTaskArtifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      className="agent-team-detail__pill agent-team-detail__pill--artifact agent-team-detail__artifact-button"
                      title={artifact.summary ?? artifact.uri ?? ''}
                      onClick={() => setSelectedArtifactId(artifact.id)}
                    >
                      {artifactLabel(artifact)}
                    </button>
                  )) : (
                    <span className="agent-team-detail__muted">
                      {selectedGraphTask.artifactCount > 0 ? `${selectedGraphTask.artifactCount} published` : 'None yet'}
                    </span>
                  )}
                </div>
              </div>
              {selectedGraphTask.result && (
                <div className="agent-team-detail__result">
                  <span className="agent-team-detail__section-title">Result</span>
                  <span>{selectedGraphTask.result}</span>
                </div>
              )}
              {selectedGraphTask.blockedReason && (
                <div className="agent-team-detail__result agent-team-detail__result--blocked">
                  <span className="agent-team-detail__section-title">Blocker</span>
                  <span>{selectedGraphTask.blockedReason}</span>
                </div>
              )}
              {selectedHumanTaskGate && selectedGraphTask.sourceTask && (
                renderHumanGate(selectedHumanTaskGate, { compact: true })
              )}
            </>
          </aside>
        )}
      </div>

      <div className="agent-team-agent-strip" aria-label="Teammates">
        {graphAgents.length === 0 ? (
          <div className="agent-team-agent-strip__empty">
            Teammates appear here after the Team Lead proposes a plan.
          </div>
        ) : graphAgents.map((agent) => (
          <button
            key={agent.key}
            type="button"
            className={`agent-team-summary-agent agent-team-summary-agent--${agent.status}${selectedAgentKey === agent.key ? ' agent-team-summary-agent--selected' : ''}${selectedGraphTask?.ownerKey === agent.key ? ' agent-team-summary-agent--task-owner' : ''}`}
            onClick={() => setSelectedAgentKey(agent.key)}
          >
            <span className="agent-team-summary-agent__name">{agent.name}</span>
            <span className={`agent-team-detail__status agent-team-detail__status--${agent.status}`}>
              {statusLabel(agent.status)}
            </span>
            <span className="agent-team-summary-agent__task">
              {agent.currentTaskTitle ?? `${agent.taskCount} task${agent.taskCount === 1 ? '' : 's'}`}
            </span>
            <span className="agent-team-summary-agent__stats">
              <span>Tasks {agent.doneCount}/{agent.taskCount}</span>
              <span>Tools {agent.toolCount ?? '—'}</span>
              <span>Artifacts {agent.artifactCount}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  const renderAgentInspector = () => {
    if (!selectedGraphAgent) return null;
    const ownedTasks = graphTasks.filter((task) => task.ownerKey === selectedGraphAgent.key);
    const agentArtifacts = selectedGraphAgent.sourceAgent
      ? artifacts.filter((artifact) => artifact.agentId === selectedGraphAgent.sourceAgent?.id)
      : [];
    const selectedAgentNode = selectedGraphAgent.sourceAgent
      ? agentNodeByAgentId.get(selectedGraphAgent.sourceAgent.id)
      : selectedGraphAgent.nodeId
        ? teamAgentNodes.find((agentNode) => agentNode.id === selectedGraphAgent.nodeId)
        : undefined;
    const selectedAgentData = selectedAgentNode?.data as AgentNodeData | undefined;
    const activityLines = recentTerminalLines(selectedAgentData?.scrollback);
    return (
      <div className="agent-team-agent-inspector" role="dialog" aria-label="Agent detail">
        <div className="agent-team-agent-inspector__panel">
          <div className="agent-team-agent-inspector__head">
            <div>
              <span className="agent-team-panel-heading__label">Agent detail</span>
              <strong>{selectedGraphAgent.name}</strong>
            </div>
            <button type="button" onClick={() => setSelectedAgentKey('')}>Close</button>
          </div>
          <div className="agent-team-agent-inspector__body">
            <div className="agent-team-agent-inspector__summary">
              <div className="agent-team-agent-inspector__meta">
                <span>{selectedGraphAgent.agentType ?? 'Coding Agent'}</span>
                <span>{statusLabel(selectedGraphAgent.status)}</span>
                {selectedGraphAgent.nodeId && <code>{selectedGraphAgent.nodeId}</code>}
              </div>
              <div className="agent-team-agent-inspector__stats">
                <span><strong>{selectedGraphAgent.taskCount}</strong> tasks</span>
                <span><strong>{selectedGraphAgent.runningCount}</strong> running</span>
                <span><strong>{selectedGraphAgent.blockedCount}</strong> blocked tasks</span>
                <span><strong>{selectedGraphAgent.artifactCount}</strong> artifacts</span>
                <span><strong>{selectedGraphAgent.toolCount ?? '—'}</strong> tools</span>
              </div>
              <div className="agent-team-agent-inspector__section">
                <span className="agent-team-detail__section-title">Assigned tasks</span>
                {ownedTasks.length === 0 ? (
                  <span className="agent-team-detail__muted">No assigned tasks.</span>
                ) : ownedTasks.map((task) => (
                  <button
                    key={task.key}
                    type="button"
                    className={`agent-team-agent-inspector__task agent-team-agent-inspector__task--${task.status}`}
                    onClick={() => selectGraphTask(task)}
                  >
                    <strong>{task.title}</strong>
                    <span>{statusLabel(task.status)}</span>
                  </button>
                ))}
              </div>
              <div className="agent-team-agent-inspector__section">
                <span className="agent-team-detail__section-title">Artifacts</span>
                {agentArtifacts.length === 0 ? (
                  <span className="agent-team-detail__muted">None yet</span>
                ) : agentArtifacts.map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    className="agent-team-detail__pill agent-team-detail__pill--artifact agent-team-detail__artifact-button"
                    title={artifact.summary ?? artifact.uri ?? ''}
                    onClick={() => setSelectedArtifactId(artifact.id)}
                  >
                    {artifactLabel(artifact)}
                  </button>
                ))}
              </div>
            </div>
            <div className="agent-team-agent-inspector__terminal">
              <div className="agent-team-agent-inspector__viewer-head">
                <div>
                  <span className="agent-team-panel-heading__label">Coding Agent</span>
                  <strong>{agentInspectorMode === 'terminal' ? 'Terminal' : 'Activity'}</strong>
                </div>
                <div className="agent-team-agent-inspector__viewer-tabs" role="tablist" aria-label="Agent detail mode">
                  <button
                    type="button"
                    className={agentInspectorMode === 'activity' ? 'is-active' : ''}
                    onClick={() => setAgentInspectorMode('activity')}
                  >
                    Activity
                  </button>
                  <button
                    type="button"
                    className={agentInspectorMode === 'terminal' ? 'is-active' : ''}
                    onClick={() => setAgentInspectorMode('terminal')}
                  >
                    Terminal
                  </button>
                </div>
              </div>
              {agentInspectorMode === 'activity' ? (
                <div className="agent-team-agent-inspector__activity">
                  <div className="agent-team-agent-inspector__activity-hero">
                    <span className={`agent-team-detail__status agent-team-detail__status--${selectedGraphAgent.status}`}>
                      {statusLabel(selectedGraphAgent.status)}
                    </span>
                    <strong>{selectedGraphAgent.currentTaskTitle ?? 'No active task'}</strong>
                    <span>{selectedGraphAgent.doneCount}/{selectedGraphAgent.taskCount} tasks complete</span>
                  </div>
                  <div className="agent-team-agent-inspector__activity-grid">
                    <span><strong>{selectedGraphAgent.toolCount ?? '—'}</strong> Tools</span>
                    <span><strong>{selectedGraphAgent.artifactCount}</strong> Artifacts</span>
                    <span><strong>{selectedAgentData?.cwd || rootFolder || '—'}</strong> Workspace</span>
                  </div>
                  <div className="agent-team-agent-inspector__recent-output">
                    <span className="agent-team-detail__section-title">Recent output</span>
                    {activityLines.length === 0 ? (
                      <span className="agent-team-detail__muted">No readable output yet.</span>
                    ) : activityLines.map((line, index) => (
                      <span key={`${index}-${line}`}>{line}</span>
                    ))}
                  </div>
                </div>
              ) : selectedAgentNode ? (
                <div className="agent-team-agent-inspector__terminal-body">
                  <AgentNodeBody
                    node={selectedAgentNode}
                    getAllNodes={getAllNodes}
                    rootFolder={rootFolder}
                    workspaceId={workspaceId}
                    workspaceName={workspaceName}
                    onUpdate={onUpdate}
                    readOnly={readOnly}
                    terminalMode="mirror"
                  />
                </div>
              ) : (
                <div className="agent-team-agent-inspector__terminal-empty">
                  <span className="agent-team-detail__section-title">Coding Agent</span>
                  <strong>No runtime node yet</strong>
                  <span>Approve and run the plan before opening the full Coding Agent view.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!teamId) return <div className="frame-body" />;

  return (
    <div
      className={`agent-team-frame agent-team-frame--${phase}`}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="agent-team-frame__top">
        <div className="agent-team-frame__identity">
          <div className="agent-team-frame__title">
            {teamTitle}
            <span className="agent-team-frame__phase-label"> · {phaseTitle}</span>
          </div>
        </div>

        <div className="agent-team-frame__actions">
          <div
            className={`agent-team-frame__status agent-team-frame__status--${teamStatus}`}
            title={loading ? 'Refreshing team snapshot' : undefined}
          >
            {phase === 'briefing' ? 'briefing' : statusLabel(teamStatus)}
          </div>
          {canPauseTeam && (
            <button
              type="button"
              className="agent-team-frame__secondary-action"
              onClick={() => void handlePauseTeam()}
              disabled={readOnly || teamAction !== null}
            >
              {teamAction === 'pause' ? 'Pausing' : 'Pause'}
            </button>
          )}
          <button
            type="button"
            className="agent-team-frame__danger-action"
            onClick={() => void handleDeleteTeam()}
            disabled={readOnly || teamAction !== null}
          >
            {teamAction === 'delete' ? 'Deleting' : 'Delete'}
          </button>
        </div>
      </div>

      {error && <div className="agent-team-frame__error">{error}</div>}

      {phase !== 'briefing' && renderTeamCommand('top')}

      <div className={`agent-team-workspace agent-team-workspace--${phase}`}>
        {renderLeadDock()}
        {renderTaskGraph()}
      </div>

      {teammateCanvasNodes.length > 0 && (
        <div className="agent-team-runtime-mounts" aria-hidden="true">
          {teammateCanvasNodes.map((agentNode) => (
            <div key={agentNode.id} className="agent-team-runtime-mount">
              <AgentNodeBody
                node={agentNode}
                getAllNodes={getAllNodes}
                rootFolder={rootFolder}
                workspaceId={workspaceId}
                workspaceName={workspaceName}
                onUpdate={onUpdate}
                readOnly={readOnly}
              />
            </div>
          ))}
        </div>
      )}

      {showGlobalGate && globalGate && (
        renderHumanGate(globalGate)
      )}

      {taskFormOpen && phase === 'executing' && (
        <div className="agent-team-task-form">
          <input
            value={taskTitle}
            onChange={(event) => setTaskTitle(event.target.value)}
            placeholder="Task title"
            disabled={readOnly}
          />
          <input
            value={taskDescription}
            onChange={(event) => setTaskDescription(event.target.value)}
            placeholder="Task instructions"
            disabled={readOnly}
          />
          <select value={taskOwner} onChange={(event) => setTaskOwner(event.target.value)} disabled={readOnly}>
            <option value="">Any teammate</option>
            {teammates.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleCreateTask}
            disabled={readOnly || !taskTitle.trim() || !taskDescription.trim()}
          >
            Create
          </button>
        </div>
      )}

      {renderAgentInspector()}

      {selectedArtifact && (
        <div className="agent-team-artifact-viewer" role="dialog" aria-label="Artifact viewer">
          <div className="agent-team-artifact-viewer__panel">
            <div className="agent-team-artifact-viewer__header">
              <div>
                <span className="agent-team-detail__section-title">{selectedArtifact.kind}</span>
                <strong>{artifactLabel(selectedArtifact)}</strong>
              </div>
              <button
                type="button"
                className="agent-team-artifact-viewer__close"
                onClick={() => {
                  setSelectedArtifactId('');
                  setArtifactPreview(null);
                }}
              >
                Close
              </button>
            </div>
            <div className="agent-team-artifact-viewer__meta">
              {selectedArtifactTask && <span>Task: {selectedArtifactTask.title}</span>}
              {selectedArtifactAgent && <span>Agent: {selectedArtifactAgent.name}</span>}
              <span>{new Date(selectedArtifact.createdAt).toLocaleString()}</span>
            </div>
            {selectedArtifact.summary && (
              <div className="agent-team-artifact-viewer__section">
                <span className="agent-team-detail__section-title">Summary</span>
                <p>{selectedArtifact.summary}</p>
              </div>
            )}
            {selectedArtifact.uri && (
              <div className="agent-team-artifact-viewer__section">
                <span className="agent-team-detail__section-title">URI</span>
                <code>{selectedArtifact.uri}</code>
              </div>
            )}
            {artifactPreview?.artifactId === selectedArtifact.id && artifactPreview.loading && (
              <div className="agent-team-artifact-viewer__empty">Loading artifact file...</div>
            )}
            {artifactPreview?.artifactId === selectedArtifact.id && artifactPreview.error && (
              <div className="agent-team-artifact-viewer__error">{artifactPreview.error}</div>
            )}
            {artifactPreview?.artifactId === selectedArtifact.id && artifactPreview.content && (
              <pre className="agent-team-artifact-viewer__content">{artifactPreview.content}</pre>
            )}
            {!selectedArtifact.summary && !selectedArtifact.uri && !artifactPreview?.content && (
              <div className="agent-team-artifact-viewer__empty">No preview content was published for this artifact.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
