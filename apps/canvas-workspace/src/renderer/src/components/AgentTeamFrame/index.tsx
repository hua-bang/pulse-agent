import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import { AgentNodeBody } from '../AgentNodeBody';
import { AgentIcon } from '../AgentNodeBody/AgentIcon';
import { AGENT_REGISTRY } from '../../config/agentRegistry';
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

const DAG_NODE_WIDTH = 236;
const DAG_NODE_HEIGHT = 58;
const DAG_COLUMN_GAP = 315;
const DAG_ROW_GAP = 76;
const DAG_LEFT = 38;
const DAG_TOP = 92;
const DAG_BOTTOM = 72;
const DAG_MIN_WIDTH = 720;
const DAG_MIN_HEIGHT = 340;

interface DagNodeItem {
  task: GraphTaskItem;
  x: number;
  y: number;
  width: number;
  height: number;
  columnIndex: number;
  rowIndex: number;
}

interface DagEdgeItem {
  key: string;
  path: string;
  sourceKey: string;
  targetKey: string;
}

interface DagStageItem {
  key: string;
  x: number;
  y: number;
  label: string;
  index: number;
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
  const [teamAction, setTeamAction] = useState<'pause' | 'resume' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefDraft, setBriefDraft] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
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
  const [graphViewportHeights, setGraphViewportHeights] = useState({ inline: 0, fullscreen: 0 });
  const [artifactPreview, setArtifactPreview] = useState<{
    artifactId: string;
    content?: string;
    error?: string;
    loading: boolean;
  } | null>(null);
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const inlineGraphViewportRef = useRef<HTMLDivElement>(null);
  const fullscreenGraphViewportRef = useRef<HTMLDivElement>(null);

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
  const buildDagLayout = useCallback((viewportHeight = 0) => {
    const columnCount = graphColumns.length;
    const maxRows = Math.max(1, ...graphColumns.map((column) => column.length));
    const contentRowsHeight = (maxRows - 1) * DAG_ROW_GAP + DAG_NODE_HEIGHT;
    const naturalHeight = DAG_TOP + contentRowsHeight + DAG_BOTTOM;
    const height = Math.max(DAG_MIN_HEIGHT, naturalHeight, viewportHeight);
    const verticalShift = Math.max(0, height - naturalHeight) / 2;
    const nodes: DagNodeItem[] = [];
    const stages: DagStageItem[] = graphColumns.map((_column, columnIndex) => ({
      key: `stage-${columnIndex}`,
      // Center the stage header over its node column (offset compensated via translateX in CSS).
      x: DAG_LEFT + columnIndex * DAG_COLUMN_GAP + DAG_NODE_WIDTH / 2,
      y: 24 + verticalShift,
      label: columnIndex === 0 ? 'Start' : `Stage ${columnIndex + 1}`,
      index: columnIndex + 1,
    }));

    for (let columnIndex = 0; columnIndex < graphColumns.length; columnIndex += 1) {
      const column = graphColumns[columnIndex];
      const columnOffset = ((maxRows - column.length) * DAG_ROW_GAP) / 2;
      for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
        const task = column[rowIndex];
        nodes.push({
          task,
          x: DAG_LEFT + columnIndex * DAG_COLUMN_GAP,
          y: DAG_TOP + verticalShift + columnOffset + rowIndex * DAG_ROW_GAP,
          width: DAG_NODE_WIDTH,
          height: DAG_NODE_HEIGHT,
          columnIndex,
          rowIndex,
        });
      }
    }

    const nodeByKey = new Map(nodes.map((item) => [item.task.key, item]));
    const edges: DagEdgeItem[] = [];
    for (const node of nodes) {
      for (const depKey of node.task.depKeys) {
        const source = nodeByKey.get(depKey);
        if (!source) continue;
        const startX = source.x + source.width - 2;
        const startY = source.y + source.height / 2;
        const endX = node.x + 2;
        const endY = node.y + node.height / 2;
        const dx = Math.max(56, (endX - startX) / 2);
        edges.push({
          key: `${source.task.key}->${node.task.key}`,
          sourceKey: source.task.key,
          targetKey: node.task.key,
          path: `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`,
        });
      }
    }

    return {
      nodes,
      edges,
      stages,
      width: Math.max(
        DAG_MIN_WIDTH,
        DAG_LEFT * 2 + Math.max(0, columnCount - 1) * DAG_COLUMN_GAP + DAG_NODE_WIDTH,
      ),
      height,
    };
  }, [graphColumns]);
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
      };
    });
  }, [artifacts, graphTaskByKey, graphTasks, phase, plan, teammates]);
  const selectedGraphAgent = graphAgents.find((agent) => agent.key === selectedAgentKey);
  const agentTypeByOwnerKey = useMemo(
    () => new Map(graphAgents.map((agent) => [agent.key, agent.agentType])),
    [graphAgents],
  );

  const teamTitle = runtime?.team.name ?? data.agentTeamName ?? node.title;
  const teamGoal = shortText(runtime?.team.goal ?? data.agentTeamGoal ?? data.label, '');
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
      : phase === 'plan_review'
        ? 'Plan Review'
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
    setAgentViewMode('activity');
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
      setError(null);
    } else {
      setError(result.error ?? 'Unable to confirm plan.');
    }
  }, [api, workspaceId, teamId]);

  const handleUpdatePlanTeammate = useCallback(async (teammateName: string, agentType: string) => {
    if (!api || !workspaceId || !teamId) return;
    const result = await api.updatePlanTeammate(workspaceId, teamId, teammateName, agentType);
    if (result.ok && result.snapshot) {
      setSnapshot(result.snapshot);
      setError(null);
    } else {
      setError(result.error ?? 'Unable to update teammate agent.');
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

  const handleResumeTeam = useCallback(async () => {
    if (!api || !workspaceId || !teamId) return;
    setTeamAction('resume');
    const result = await api.resume(workspaceId, teamId);
    setTeamAction(null);
    if (result.ok && result.snapshot) {
      setSnapshot(result.snapshot);
      setError(null);
    } else {
      setError(result.error ?? 'Unable to resume the Agent Team.');
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
  const edgeMarkerId = `agent-team-dag-arrow-${(teamId ?? node.id).replace(/[^\w-]/g, '-')}`;
  const graphSubtitle = phase === 'briefing'
    ? 'Brief Team Lead to generate a plan.'
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
    if (graphColumns.length === 0) {
      return (
        <div className="agent-team-graph-empty">
          <span className="agent-team-empty-panel__eyebrow">No graph yet</span>
          <strong>Waiting for Team Lead to propose tasks.</strong>
          <span>The graph appears after the lead submits a plan.</span>
        </div>
      );
    }

    const markerId = variant === 'fullscreen' ? `${edgeMarkerId}-fullscreen` : edgeMarkerId;
    const dagLayout = variant === 'fullscreen' ? fullscreenDagLayout : inlineDagLayout;
    return (
      <div
        className={`agent-team-dag-canvas${variant === 'fullscreen' ? ' agent-team-dag-canvas--fullscreen' : ''}`}
        style={{ width: dagLayout.width, height: dagLayout.height }}
      >
        <svg
          className="agent-team-dag-edges"
          width={dagLayout.width}
          height={dagLayout.height}
          viewBox={`0 0 ${dagLayout.width} ${dagLayout.height}`}
          aria-hidden="true"
        >
          <defs>
            <marker
              id={markerId}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>
          {dagLayout.edges.map((edge) => {
            const highlighted = selectedGraphTask
              ? edge.sourceKey === selectedGraphTask.key || edge.targetKey === selectedGraphTask.key
              : false;
            return (
              <path
                key={edge.key}
                className={`agent-team-dag-edge${highlighted ? ' agent-team-dag-edge--highlighted' : ''}`}
                d={edge.path}
                markerEnd={`url(#${markerId})`}
              />
            );
          })}
        </svg>

        {dagLayout.stages.map((stage) => (
          <span
            key={stage.key}
            className="agent-team-dag-stage"
            style={{ left: stage.x, top: stage.y }}
          >
            <span className="agent-team-dag-stage__index">{stage.index}</span>
            {stage.label}
          </span>
        ))}

        {dagLayout.nodes.map((item) => {
          const task = item.task;
          const selected = selectedGraphTask?.key === task.key;
          const ownerHighlighted = !!selectedAgentKey && task.ownerKey === selectedAgentKey;
          return (
            <button
              key={task.key}
              type="button"
              className={`agent-team-dag-node agent-team-dag-node--${task.status}${selected ? ' agent-team-dag-node--selected' : ''}${ownerHighlighted ? ' agent-team-dag-node--owner-highlight' : ''}${task.dependencyWarning ? ' agent-team-dag-node--warning' : ''}`}
              style={{
                left: item.x,
                top: item.y,
                width: item.width,
                height: item.height,
              }}
              onClick={() => selectGraphTask(task)}
              title={task.title}
            >
              <span className={`agent-team-task-row__dot agent-team-task-row__dot--${task.status}`} />
              <span className="agent-team-dag-node__copy">
                <strong>{task.title}</strong>
                <span className="agent-team-dag-node__meta">
                  <span>{statusLabel(task.status)}</span>
                  {renderOwnerChip(task.ownerKey, task.ownerName)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
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
  const canResumeTeam = phase === 'executing' && teamStatus === 'paused';
  const showGlobalGate = !!globalGate
    && !selectedHumanTaskGate
    && phase === 'executing'
    && isHumanFacingGate(globalGate);

  const renderTeamCommand = (placement: 'top' | 'lead' = 'top') => (
    <div className={`agent-team-command agent-team-command--${placement}`} aria-label="Team command">
      <div className="agent-team-command__copy">
        <span className="agent-team-command__label">
          {phase === 'briefing' ? 'Brief Team Lead' : 'Message Team Lead'}
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
              agentTeamStatus={teamStatus}
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
                    ? 'Send normal changes to the lead and let the lead route work to the right teammate.'
                    : 'Tell the lead what outcome, repo path, constraints, and teammate split you expect.'}
              </span>
            </div>

            <div className="agent-team-lead-dock__meta">
              <span>Provider</span>
              <strong>{lead?.sessionRef?.displayName ?? lead?.sessionRef?.provider ?? 'Coding Agent'}</strong>
              {leadNodeId && <code>{leadNodeId}</code>}
            </div>

            {phase === 'briefing' && renderTeamCommand('lead')}
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
            {statusLabel(selectedGraphAgent.status)}
          </span>
        </div>

        <div className={`agent-team-agent-detail__viewer${agentViewMode === 'terminal' ? ' agent-team-agent-detail__viewer--terminal' : ''}`}>
          <div className="agent-team-subtabs" role="tablist" aria-label="Agent view">
            <button
              type="button"
              role="tab"
              aria-selected={agentViewMode === 'activity'}
              className={`agent-team-subtab${agentViewMode === 'activity' ? ' is-active' : ''}`}
              onClick={() => setAgentViewMode('activity')}
            >
              Activity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={agentViewMode === 'terminal'}
              className={`agent-team-subtab${agentViewMode === 'terminal' ? ' is-active' : ''}`}
              onClick={() => setAgentViewMode('terminal')}
            >
              Terminal
            </button>
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
                  <AgentIcon id={selectedGraphAgent.agentType ?? 'pulse-coder'} size={13} />
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
        <div className="agent-team-detail-tabs" role="tablist" aria-label="Detail view">
          <button
            type="button"
            role="tab"
            aria-selected={!agentActive}
            className={`agent-team-detail-tab${!agentActive ? ' is-active' : ''}`}
            onClick={() => setDetailPanelMode('task')}
          >
            Task
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={agentActive}
            className={`agent-team-detail-tab${agentActive ? ' is-active' : ''}`}
            onClick={() => setDetailPanelMode('agent')}
          >
            Agent
          </button>
        </div>
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
          return (
            <div
              key={agent.key}
              role="button"
              tabIndex={0}
              className={`agent-team-summary-agent agent-team-summary-agent--${agent.status}${selectedAgentKey === agent.key ? ' agent-team-summary-agent--selected' : ''}${selectedGraphTask?.ownerKey === agent.key ? ' agent-team-summary-agent--task-owner' : ''}`}
              onClick={selectAgent}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectAgent();
                }
              }}
            >
              <span className="agent-team-summary-agent__name">
                <span className="agent-team-summary-agent__logo">
                  <AgentIcon id={agent.agentType ?? 'pulse-coder'} size={14} />
                </span>
                {agent.name}
              </span>
              <span className={`agent-team-detail__status agent-team-detail__status--${agent.status}`}>
                {statusLabel(agent.status)}
              </span>
              {editable ? (
                <label
                  className="agent-team-summary-agent__agent-select"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="agent-team-summary-agent__agent-select-label">Coding agent</span>
                  <select
                    value={TEAM_AGENT_OPTIONS.some((def) => def.id === agent.agentType)
                      ? agent.agentType
                      : TEAM_AGENT_OPTIONS[0].id}
                    aria-label={`Coding agent for ${agent.name}`}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation();
                      void handleUpdatePlanTeammate(agent.name, event.target.value);
                    }}
                  >
                    {TEAM_AGENT_OPTIONS.map((def) => (
                      <option key={def.id} value={def.id}>{def.label}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="agent-team-summary-agent__task">
                  {agent.currentTaskTitle ?? `${agent.taskCount} task${agent.taskCount === 1 ? '' : 's'}`}
                </span>
              )}
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
          {variant === 'inline' && graphColumns.length > 0 && (
            <button
              type="button"
              className="agent-team-graph-panel__fullscreen"
              onClick={() => setGraphFullscreenOpen(true)}
            >
              Full screen
            </button>
          )}
          {phase === 'plan_review' && plan && (
            <button type="button" className="agent-team-frame__primary-action" onClick={handleConfirmPlan} disabled={readOnly}>
              Approve & Run
            </button>
          )}
          {variant === 'fullscreen' && (
            <button type="button" onClick={() => setGraphFullscreenOpen(false)}>
              Close
            </button>
          )}
        </div>
      </div>

      <div
        className={`agent-team-graph-panel__main${
          selectedGraphTask || selectedGraphAgent
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
            <AgentIcon id={selectedGraphAgent.agentType ?? 'pulse-coder'} size={13} />
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
          <div className="agent-team-frame__mission">
            <span className="agent-team-frame__mission-brief" title={teamGoal || undefined}>
              Task · {teamGoal || 'No task brief yet'}
            </span>
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
            {phase === 'briefing' ? 'briefing' : statusLabel(teamStatus)}
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
