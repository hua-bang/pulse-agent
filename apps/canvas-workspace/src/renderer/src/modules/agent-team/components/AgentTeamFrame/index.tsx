import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import { AgentNodeBody } from '../../../coding-agent/surface';
import { AgentIcon } from '../../../coding-agent/icon';
import {
  buildAgentTeamDagLayout,
  createAgentTeamWorkspaceModel,
  type AgentTeamGraphTask,
} from '../../model/workspaceModel';
import { AgentTypeSelect } from './AgentTypeSelect';
import { TaskDagCanvas } from '../TaskDagCanvas';
import { HumanGateCard, hasConcreteHumanGatePrompt } from '../HumanGateCard';
import { TeamCommand } from '../TeamCommand';
import { agentSessionHealthSuffix as sessionHealthSuffix, agentTeamStatusLabel as statusLabel } from '../visualLabels';
import { useAgentTeamWorkspaceController } from '../../controller/useAgentTeamWorkspaceController';
import { SegmentedControl } from '../../../../components/ui';
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

const shortText = (value: string | undefined, fallback: string) =>
  value?.trim() || fallback;

const compactPath = (value: string | undefined, maxLength = 54): string => {
  const path = value?.trim();
  if (!path) return '';
  if (path.length <= maxLength) return path;
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const compact = `.../${parts.slice(-2).join('/')}`;
    if (compact.length <= maxLength) return compact;
  }
  return `...${path.slice(Math.max(0, path.length - maxLength + 3))}`;
};

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

const agentTypeLabel = (agentType?: string): string =>
  AGENT_REGISTRY.find((def) => def.id === agentType)?.label ?? agentType ?? 'Coding Agent';

// Agent Teams currently supports only Claude Code and Codex for teammates.
const TEAM_AGENT_OPTIONS = AGENT_REGISTRY.filter((def) => def.id === 'claude-code' || def.id === 'codex');

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

type GraphTaskItem = AgentTeamGraphTask;

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
  sessionHealth?: string;
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
  const workspaceActive = useWorkspaceActive();
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [gateAnswers, setGateAnswers] = useState<Record<string, string>>({});
  const [selectedArtifactId, setSelectedArtifactId] = useState('');
  const [selectedAgentKey, setSelectedAgentKey] = useState('');
  const [agentInspectorMode, setAgentInspectorMode] = useState<'activity' | 'terminal'>('terminal');
  const [agentViewMode, setAgentViewMode] = useState<'activity' | 'terminal'>('activity');
  const [detailPanelMode, setDetailPanelMode] = useState<'task' | 'agent'>('task');
  const [agentInspectorOpen, setAgentInspectorOpen] = useState(false);
  const [selectedPlanTaskKey, setSelectedPlanTaskKey] = useState('');
  const [graphFullscreenOpen, setGraphFullscreenOpen] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [graphViewportHeights, setGraphViewportHeights] = useState({ inline: 0, fullscreen: 0 });
  const [artifactPreview, setArtifactPreview] = useState<{
    artifactId: string;
    content?: string;
    error?: string;
    loading: boolean;
  } | null>(null);
  const inlineGraphViewportRef = useRef<HTMLDivElement>(null);
  const fullscreenGraphViewportRef = useRef<HTMLDivElement>(null);
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
    teamAgentNodes.map((agentNode) => [agentNode.data.agentTeamAgentId, agentNode]),
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
  const graphTasks = workspaceModel?.tasks ?? [];
  const graphTaskByKey = useMemo(
    () => new Map(graphTasks.map((task) => [task.key, task])),
    [graphTasks],
  );
  const graphRounds = workspaceModel?.rounds ?? [];
  // Each round is its own DAG (a planned wave). The switcher lets the user view one
  // round at a time; team-wide data (graphTasks/graphAgents) is intentionally untouched.
  const roundOptions = workspaceModel?.roundOptions ?? [];
  const activeRound = useMemo(() => {
    if (roundOptions.length === 0) return null;
    if (selectedRound != null && roundOptions.some((option) => option.round === selectedRound)) {
      return selectedRound;
    }
    return roundOptions[roundOptions.length - 1].round;
  }, [roundOptions, selectedRound]);
  const visibleRounds = useMemo(() => {
    if (graphRounds.length <= 1 || activeRound == null) return graphRounds;
    const matched = graphRounds.filter((group) => group.round === activeRound);
    return matched.length > 0 ? matched : graphRounds;
  }, [graphRounds, activeRound]);
  const buildDagLayout = useCallback(
    (viewportHeight = 0) => buildAgentTeamDagLayout(visibleRounds, viewportHeight),
    [visibleRounds],
  );
  const inlineDagLayout = useMemo(
    () => buildDagLayout(graphViewportHeights.inline),
    [buildDagLayout, graphViewportHeights.inline],
  );
  const fullscreenDagLayout = useMemo(
    () => buildDagLayout(graphViewportHeights.fullscreen),
    [buildDagLayout, graphViewportHeights.fullscreen],
  );
  const selectedGraphTask = useMemo(() => {
    if (phase === 'plan_review') {
      return graphTaskByKey.get(selectedPlanTaskKey) ?? graphTasks[0];
    }
    return selectedTask ? graphTaskByKey.get(selectedTask.id) : graphTasks[0];
  }, [graphTaskByKey, graphTasks, phase, selectedPlanTaskKey, selectedTask]);
  const graphAgents = useMemo<GraphAgentItem[]>(() => {
    if (phase === 'plan_review' && plan) {
      return plan.teammates.map((teammate) => {
        const ownerKey = `plan:${teammate.name.trim().toLowerCase()}`;
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
        agentType: agentNodeByAgentId.get(agent.id)?.data?.agentType
          ?? agent.sessionRef?.provider ?? agent.sessionRef?.displayName,
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
        sessionHealth: snapshot?.sessions?.[agent.id],
      };
    });
  }, [artifacts, graphTaskByKey, graphTasks, phase, plan, teammates, snapshot?.sessions]);
  const selectedGraphAgent = graphAgents.find((agent) => agent.key === selectedAgentKey);
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
    setDetailPanelMode('task');
    setAgentInspectorOpen(false);
  }, [graphAgents, selectedAgentKey]);

  useEffect(() => {
    setAgentInspectorMode('terminal');
    setAgentViewMode('terminal');
  }, [selectedAgentKey]);

  useEffect(() => {
    if (!graphFullscreenOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGraphFullscreenOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [graphFullscreenOpen]);

  useEffect(() => {
    const updateHeight = (key: 'inline' | 'fullscreen', element: HTMLDivElement | null) => {
      if (!element) return;
      const height = Math.round(element.getBoundingClientRect().height);
      setGraphViewportHeights((current) =>
        current[key] === height ? current : { ...current, [key]: height },
      );
    };

    updateHeight('inline', inlineGraphViewportRef.current);
    updateHeight('fullscreen', fullscreenGraphViewportRef.current);

    if (typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === inlineGraphViewportRef.current) {
          const height = Math.round(entry.contentRect.height);
          setGraphViewportHeights((current) =>
            current.inline === height ? current : { ...current, inline: height },
          );
        } else if (entry.target === fullscreenGraphViewportRef.current) {
          const height = Math.round(entry.contentRect.height);
          setGraphViewportHeights((current) =>
            current.fullscreen === height ? current : { ...current, fullscreen: height },
          );
        }
      }
    });

    if (inlineGraphViewportRef.current) observer.observe(inlineGraphViewportRef.current);
    if (fullscreenGraphViewportRef.current) observer.observe(fullscreenGraphViewportRef.current);
    return () => observer.disconnect();
  }, [graphFullscreenOpen]);

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

  const selectGraphTask = (task: GraphTaskItem) => {
    if (task.sourceTask) setSelectedTaskId(task.sourceTask.id);
    else setSelectedPlanTaskKey(task.key);
    setSelectedAgentKey(task.ownerKey ?? '');
    setDetailPanelMode('task');
  };

  const ownerChipClass = (ownerKey?: string) =>
    `agent-team-owner-chip${ownerKey && selectedAgentKey === ownerKey ? ' agent-team-owner-chip--active' : ''}`;

  const renderOwnerChip = (ownerKey: string | undefined, ownerName: string) => {
    const agentType = ownerKey ? agentTypeByOwnerKey.get(ownerKey) : undefined;
    return (
      <span className={ownerChipClass(ownerKey)}>
        {agentType && (
          <span className="agent-team-owner-chip__logo">
            <AgentIcon id={agentType} size={12} />
          </span>
        )}
        {ownerName}
      </span>
    );
  };

  const renderDagCanvas = (variant: 'inline' | 'fullscreen' = 'inline') => {
    if (graphRounds.length === 0) {
      return (
        <div className="agent-team-graph-empty">
          <span className="agent-team-empty-panel__eyebrow">No graph yet</span>
          <strong>Waiting for Team Lead to propose tasks.</strong>
          <span>The graph appears after the lead submits a plan.</span>
        </div>
      );
    }
    return (
      <TaskDagCanvas
        layout={variant === 'fullscreen' ? fullscreenDagLayout : inlineDagLayout}
        markerId={variant === 'fullscreen' ? `${edgeMarkerId}-fullscreen` : edgeMarkerId}
        fullscreen={variant === 'fullscreen'}
        selectedTask={selectedGraphTask}
        selectedAgentKey={selectedAgentKey}
        agentTypeByOwnerKey={agentTypeByOwnerKey}
        onSelectTask={selectGraphTask}
      />
    );
  };

  const renderGraphFullscreen = () => {
    if (!graphFullscreenOpen) return null;
    return (
      <div
        className="agent-team-dag-fullscreen agent-team-dag-fullscreen--workspace"
        role="dialog"
        aria-label="Task workspace full screen"
        onMouseDown={() => setGraphFullscreenOpen(false)}
      >
        <div
          className="agent-team-dag-fullscreen__panel agent-team-dag-fullscreen__panel--workspace"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {renderTaskGraph('fullscreen')}
        </div>
      </div>
    );
  };

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
      onViewTask={selectGraphTask}
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

  const renderLeadDock = () => (
    <section className="agent-team-lead-dock" aria-label="Team Lead">
      <div className="agent-team-lead-dock__head">
        <strong>{lead?.name ?? 'Team Lead'}</strong>
        <span className={`agent-team-detail__status agent-team-detail__status--${lead?.status ?? 'idle'}`}>
          {statusLabel(lead?.status ?? 'idle')}{sessionHealthSuffix(lead ? snapshot?.sessions?.[lead.id] : undefined)}
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
              teamLeadBriefSlot={shouldShowLeadCommandSlot ? renderTeamCommand('lead') : undefined}
              agentTeamStatus={teamStatus}
              onUpdate={onUpdate}
              readOnly={readOnly}
              forceTeamWarmup={phase === 'starting'}
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
                  ? 'Review the graph and send feedback to revise. Approve when the plan looks right.'
                  : phase === 'executing'
                    ? 'Send normal changes to the lead and let the lead route work to the right teammate.'
                    : 'Tell the lead what outcome, repo path, constraints, and teammate split you expect.'}
              </span>
            </div>

            <div className="agent-team-lead-dock__meta">
              <span>Provider</span>
              <strong>{lead?.sessionRef?.displayName ?? lead?.sessionRef?.provider ?? 'Coding Agent'}</strong>
              {leadNodeId && <code>{leadNodeId}</code>}
            </div>

            {shouldShowLeadCommandSlot && renderTeamCommand('lead')}
          </>
        )}
      </div>
    </section>
  );

  const getAgentDetailContext = (agent: GraphAgentItem) => {
    const ownedTasks = graphTasks.filter((task) => task.ownerKey === agent.key);
    const agentArtifacts = agent.sourceAgent
      ? artifacts.filter((artifact) => artifact.agentId === agent.sourceAgent?.id)
      : [];
    const agentNode = agent.sourceAgent
      ? agentNodeByAgentId.get(agent.sourceAgent.id)
      : agent.nodeId
        ? teamAgentNodes.find((candidate) => candidate.id === agent.nodeId)
        : undefined;
    const agentData = agentNode?.data as AgentNodeData | undefined;
    return {
      ownedTasks,
      agentArtifacts,
      agentNode,
      agentData,
      activityLines: recentTerminalLines(agentData?.scrollback),
    };
  };

  const renderAgentDetailContent = () => {
    if (!selectedGraphAgent) {
      return <div className="agent-team-detail__muted agent-team-detail__empty">Select an agent to see its detail.</div>;
    }
    const { ownedTasks, agentArtifacts, agentNode, agentData, activityLines } = getAgentDetailContext(selectedGraphAgent);
    return (
      <>
        <div className="agent-team-graph-detail__head">
          <div>
            <span className="agent-team-panel-heading__label">Selected agent</span>
            <strong>{selectedGraphAgent.name}</strong>
          </div>
          <span className={`agent-team-detail__status agent-team-detail__status--${selectedGraphAgent.status}`}>
            {statusLabel(selectedGraphAgent.status)}{sessionHealthSuffix(selectedGraphAgent.sessionHealth)}
          </span>
        </div>

        <div className={`agent-team-agent-detail__viewer${agentViewMode === 'terminal' ? ' agent-team-agent-detail__viewer--terminal' : ''}`}>
          <div className="agent-team-subtabs">
            <SegmentedControl
              ariaPattern="tab"
              ariaLabel="Agent view"
              value={agentViewMode}
              onChange={(id) => setAgentViewMode(id as 'activity' | 'terminal')}
              options={[
                { id: 'activity', label: 'Activity' },
                { id: 'terminal', label: 'Terminal' },
              ]}
            />
            <button
              type="button"
              className="agent-team-subtab-expand"
              title="Open in large view"
              aria-label="Open in large view"
              onClick={() => {
                setAgentInspectorMode(agentViewMode);
                setAgentInspectorOpen(true);
              }}
            >
              ⤢
            </button>
          </div>
          {agentViewMode === 'activity' ? (
            <div className="agent-team-agent-detail__activity">
              <div className="agent-team-agent-detail__meta">
                <span className="agent-team-detail__agent-type">
                  <AgentIcon id={selectedGraphAgent.agentType ?? 'claude-code'} size={13} />
                  {agentTypeLabel(selectedGraphAgent.agentType)}
                </span>
                {selectedGraphAgent.nodeId && <code>{selectedGraphAgent.nodeId}</code>}
                <span>{agentData?.cwd || rootFolder || 'No workspace'}</span>
              </div>

              <div className="agent-team-agent-detail__stats">
                <span><strong>{selectedGraphAgent.taskCount}</strong> tasks</span>
                <span><strong>{selectedGraphAgent.runningCount}</strong> running</span>
                <span><strong>{selectedGraphAgent.blockedCount}</strong> blocked</span>
                <span><strong>{selectedGraphAgent.artifactCount}</strong> artifacts</span>
              </div>

              <div className="agent-team-agent-detail__section">
                <span className="agent-team-detail__section-title">Current task</span>
                <strong>{selectedGraphAgent.currentTaskTitle ?? 'No active task'}</strong>
              </div>

              <div className="agent-team-agent-detail__section">
                <span className="agent-team-detail__section-title">Assigned tasks</span>
                {ownedTasks.length === 0 ? (
                  <span className="agent-team-detail__muted">No assigned tasks.</span>
                ) : ownedTasks.map((task) => (
                  <button
                    key={task.key}
                    type="button"
                    className={`agent-team-agent-detail__task agent-team-agent-detail__task--${task.status}`}
                    onClick={() => selectGraphTask(task)}
                  >
                    <strong>{task.title}</strong>
                    <span>{statusLabel(task.status)}</span>
                  </button>
                ))}
              </div>

              <div className="agent-team-agent-detail__section">
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

              <div className="agent-team-agent-detail__section">
                <span className="agent-team-detail__section-title">Recent output</span>
                {activityLines.length === 0 ? (
                  <span className="agent-team-detail__muted">No readable output yet.</span>
                ) : activityLines.map((line, index) => (
                  <span key={`${index}-${line}`} className="agent-team-agent-detail__output">{line}</span>
                ))}
              </div>
            </div>
          ) : agentNode ? (
            <div className="agent-team-agent-detail__inline-terminal">
              <AgentNodeBody
                node={agentNode}
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
            <div className="agent-team-detail__muted agent-team-detail__empty">
              No runtime node yet. Approve &amp; run the plan to stream the terminal.
            </div>
          )}
        </div>
      </>
    );
  };

  const renderTaskDetailContent = () => {
    if (!selectedGraphTask) {
      return <div className="agent-team-detail__muted agent-team-detail__empty">Select a task to see its detail.</div>;
    }
    return (
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
            {renderOwnerChip(selectedGraphTask.ownerKey, selectedGraphTask.ownerName)}
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
        {selectedGraphTask.scope && selectedGraphTask.scope.length > 0 && (
          <div className="agent-team-detail__result">
            <span className="agent-team-detail__section-title">Scope</span>
            <span>{selectedGraphTask.scope.join(', ')}</span>
          </div>
        )}
        {selectedGraphTask.verify && (
          <div className="agent-team-detail__result">
            <span className="agent-team-detail__section-title">Verify</span>
            <span>{selectedGraphTask.verify}</span>
          </div>
        )}
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
    );
  };

  const renderDetailPanel = () => {
    const agentActive = detailPanelMode === 'agent';
    return (
      <aside
        className={`agent-team-graph-detail agent-team-graph-detail--tabbed${agentActive ? ' agent-team-graph-detail--agent' : ''}`}
        aria-label="Selected detail"
      >
        <SegmentedControl
          className="agent-team-detail-tabs"
          ariaPattern="tab"
          ariaLabel="Detail view"
          value={detailPanelMode}
          onChange={(id) => setDetailPanelMode(id as 'task' | 'agent')}
          options={[
            { id: 'task', label: 'Task' },
            { id: 'agent', label: 'Agent' },
          ]}
        />
        {agentActive ? renderAgentDetailContent() : renderTaskDetailContent()}
      </aside>
    );
  };

  const renderAgentsStrip = () => (
    <div className="agent-team-agent-area" aria-label="Agents">
      <div className="agent-team-agent-area__head">
        <span className="agent-team-panel-heading__label">Agents</span>
        <strong>{graphAgents.length} agent{graphAgents.length === 1 ? '' : 's'}</strong>
      </div>
      <div className="agent-team-agent-strip">
        {graphAgents.length === 0 ? (
          <div className="agent-team-agent-strip__empty">
            Agents appear here after the Team Lead proposes a plan.
          </div>
        ) : graphAgents.map((agent) => {
          const selectAgent = () => {
            setSelectedAgentKey(agent.key);
            setDetailPanelMode('agent');
          };
          const editable = phase === 'plan_review' && agent.role === 'teammate' && !readOnly;
          const agentClasses = `agent-team-summary-agent agent-team-summary-agent--${agent.status}${selectedAgentKey === agent.key ? ' agent-team-summary-agent--selected' : ''}${selectedGraphTask?.ownerKey === agent.key ? ' agent-team-summary-agent--task-owner' : ''}`;
          const taskLabel = agent.currentTaskTitle ?? `${agent.taskCount} task${agent.taskCount === 1 ? '' : 's'}`;
          return (
            <div key={agent.key} className={agentClasses}>
              <button
                type="button"
                className="agent-team-summary-agent__identity"
                aria-pressed={selectedAgentKey === agent.key}
                aria-label={`Select ${agent.name}`}
                onClick={selectAgent}
              >
                <span className="agent-team-summary-agent__name">
                  <span className="agent-team-summary-agent__logo">
                    <AgentIcon id={agent.agentType ?? 'claude-code'} size={14} />
                  </span>
                  {agent.name}
                </span>
                <span className={`agent-team-detail__status agent-team-detail__status--${agent.status}`}>
                  {statusLabel(agent.status)}{sessionHealthSuffix(agent.sessionHealth)}
                </span>
                {!editable ? (
                  <span className="agent-team-summary-agent__task">
                    {taskLabel}
                  </span>
                ) : null}
              </button>
              {editable ? (
                <div className="agent-team-summary-agent__agent-select">
                  <span className="agent-team-summary-agent__agent-select-label">Coding agent</span>
                  <AgentTypeSelect
                    value={TEAM_AGENT_OPTIONS.some((def) => def.id === agent.agentType)
                      ? (agent.agentType as string)
                      : TEAM_AGENT_OPTIONS[0].id}
                    options={TEAM_AGENT_OPTIONS}
                    ariaLabel={`Coding agent for ${agent.name}`}
                    onChange={(id) => void handleUpdatePlanTeammate(agent.name, id)}
                  />
                </div>
              ) : null}
              <span className="agent-team-summary-agent__stats">
                <span>Tasks {agent.doneCount}/{agent.taskCount}</span>
                <span>Tools {agent.toolCount ?? '—'}</span>
                <span>Artifacts {agent.artifactCount}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderTaskGraph = (variant: 'inline' | 'fullscreen' = 'inline') => (
    <section className={`agent-team-graph-panel agent-team-graph-panel--${variant}`} aria-label="Task Graph">
      <div className="agent-team-graph-panel__head">
        <div>
          <span className="agent-team-panel-heading__label">{graphTitle}</span>
          <strong>{graphSubtitle}</strong>
        </div>
        <div className="agent-team-graph-panel__actions">
          {roundOptions.length > 1 && (
            <SegmentedControl
              ariaPattern="tab"
              ariaLabel="Rounds"
              value={String(activeRound)}
              onChange={(id) => setSelectedRound(Number(id))}
              options={roundOptions.map((option) => ({
                id: String(option.round),
                title: `Round ${option.round} · ${option.doneCount}/${option.taskCount} done`,
                label: (
                  <>
                    <span className={`agent-team-task-row__dot agent-team-task-row__dot--${option.status}`} />
                    Round {option.round}
                  </>
                ),
              }))}
            />
          )}
          {phase === 'plan_review' && plan?.integrationVerify && (
            <span className="agent-team-frame__hint" title={plan.integrationVerify}>
              Integration verify: <code>{plan.integrationVerify}</code>
            </span>
          )}
          {phase === 'plan_review' && plan && (
            <button type="button" className="agent-team-frame__primary-action" onClick={handleConfirmPlan} disabled={readOnly || planAction !== null}>
              {planAction === 'confirm' ? 'Approving…' : 'Approve & Run'}
            </button>
          )}
          {isCheckpoint && (
            <>
              <button type="button" className="agent-team-frame__secondary-action" onClick={() => void handleFinalizeCheckpoint()} disabled={readOnly || planAction !== null}>
                {planAction === 'finalize' ? 'Finishing…' : 'Finish'}
              </button>
              <button type="button" className="agent-team-frame__primary-action" onClick={() => void handleAdvanceRound()} disabled={readOnly || planAction !== null}>
                {planAction === 'advance' ? 'Starting…' : `Continue to Round ${(checkpointRound ?? 0) + 1}`}
              </button>
            </>
          )}
          {variant === 'fullscreen' && (
            <button type="button" onClick={() => setGraphFullscreenOpen(false)}>
              Close
            </button>
          )}
        </div>
      </div>

      <div
        className={`agent-team-graph-panel__main${selectedGraphTask || selectedGraphAgent
            ? ''
            : ' agent-team-graph-panel__main--graph-only'
          }`}
      >
        <div
          ref={variant === 'fullscreen' ? fullscreenGraphViewportRef : inlineGraphViewportRef}
          className="agent-team-task-graph"
          aria-label="Task dependency graph"
        >
          {renderDagCanvas(variant)}
        </div>

        {(selectedGraphTask || selectedGraphAgent) && renderDetailPanel()}
      </div>

      {renderAgentsStrip()}
    </section>
  );

  const renderAgentInspector = () => {
    if (!agentInspectorOpen || !selectedGraphAgent) return null;
    const {
      ownedTasks,
      agentArtifacts,
      agentNode: selectedAgentNode,
      agentData: selectedAgentData,
      activityLines,
    } = getAgentDetailContext(selectedGraphAgent);
    return (
      <div className="agent-team-agent-inspector" role="dialog" aria-label="Agent detail">
        <div className="agent-team-agent-inspector__panel">
          <div className="agent-team-agent-inspector__head">
            <div>
              <span className="agent-team-panel-heading__label">Agent detail</span>
              <strong>{selectedGraphAgent.name}</strong>
            </div>
            <button type="button" onClick={() => setAgentInspectorOpen(false)}>Close</button>
          </div>
          <div className="agent-team-agent-inspector__body">
            <div className="agent-team-agent-inspector__summary">
              <div className="agent-team-agent-inspector__meta">
                <span className="agent-team-detail__agent-type">
                  <AgentIcon id={selectedGraphAgent.agentType ?? 'claude-code'} size={13} />
                  {agentTypeLabel(selectedGraphAgent.agentType)}
                </span>
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
                <SegmentedControl
                  className="agent-team-agent-inspector__viewer-tabs"
                  ariaPattern="tab"
                  ariaLabel="Agent detail mode"
                  value={agentInspectorMode}
                  onChange={(id) => setAgentInspectorMode(id as 'activity' | 'terminal')}
                  options={[
                    { id: 'activity', label: 'Activity' },
                    { id: 'terminal', label: 'Terminal' },
                  ]}
                />
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
          <div className="agent-team-frame__mission">
            {teamCwd && (
              <code title={teamCwd}>{compactPath(teamCwd)}</code>
            )}
            <span>{doneTaskCount}/{tasks.length} tasks</span>
            {activeTaskCount > 0 && <span>{activeTaskCount} active</span>}
          </div>
        </div>

        <div className="agent-team-frame__actions">
          <div
            className={`agent-team-frame__status agent-team-frame__status--${teamStatus}`}
            title={loading ? 'Refreshing team snapshot' : undefined}
          >
            {phase === 'briefing' ? 'briefing' : phase === 'starting' ? 'starting' : statusLabel(teamStatus)}
          </div>
          {canResumeTeam && (
            <button
              type="button"
              className="agent-team-frame__primary-action"
              onClick={() => void handleResumeTeam()}
              disabled={readOnly || teamAction !== null}
            >
              {teamAction === 'resume' ? 'Resuming' : 'Resume'}
            </button>
          )}
          {canDispatch && (
            <button
              type="button"
              className="agent-team-frame__primary-action"
              onClick={() => void handleDispatch()}
              disabled={readOnly || teamAction !== null}
            >
              {teamAction === 'dispatch' ? 'Dispatching' : 'Dispatch'}
            </button>
          )}
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

      {isCheckpoint && (
        <div className="agent-team-checkpoint-banner">
          <div className="agent-team-checkpoint-banner__copy">
            <strong>Round {checkpointRound} complete</strong>
            <span>
              Review results, then continue to plan the next round or finish up.
            </span>
          </div>
          <div className="agent-team-checkpoint-banner__actions">
            <button
              type="button"
              className="agent-team-frame__secondary-action"
              onClick={() => void handleFinalizeCheckpoint()}
              disabled={readOnly || planAction !== null}
            >
              {planAction === 'finalize' ? 'Finishing…' : 'Finish'}
            </button>
            <button
              type="button"
              className="agent-team-frame__primary-action"
              onClick={() => void handleAdvanceRound()}
              disabled={readOnly || planAction !== null}
            >
              {planAction === 'advance' ? 'Starting…' : `Continue to Round ${(checkpointRound ?? 0) + 1}`}
            </button>
          </div>
        </div>
      )}

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
                forceTeamWarmup={phase === 'starting'}
              />
            </div>
          ))}
        </div>
      )}

      {showGlobalGate && globalGate && (
        renderHumanGate(globalGate)
      )}

      {renderGraphFullscreen()}
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
