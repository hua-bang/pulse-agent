import type {
  AgentNodeData,
  AgentTeamAgentRecord,
  AgentTeamArtifactRecord,
  AgentTeamPhase,
  AgentTeamPlanDraft,
  AgentTeamSnapshot,
  AgentTeamTaskRecord,
  CanvasNode,
} from '../../../types';

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

const DOWNSTREAM_TASK_RE = /(qa|test|测试|验收|验证|联调|review|审核|文档|document|summary|总结|release|发布|交付)/i;
const graphKeyFromTitle = (title: string) => title.trim().toLowerCase();
const taskStatusRank = (task: AgentTeamTaskRecord) => TASK_STATUS_RANK[task.status] ?? 99;

export interface AgentTeamGraphTask {
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
  scope?: string[];
  verify?: string;
  sourceTask?: AgentTeamTaskRecord;
  dependencyWarning?: boolean;
}

export interface AgentTeamGraphRound {
  round: number;
  columns: AgentTeamGraphTask[][];
}

export interface AgentTeamRoundOption {
  round: number;
  taskCount: number;
  doneCount: number;
  status: 'running' | 'blocked' | 'done' | 'todo';
}

export interface AgentTeamWorkspaceModel {
  phase: AgentTeamPhase;
  agents: AgentTeamAgentRecord[];
  teammates: AgentTeamAgentRecord[];
  tasks: AgentTeamGraphTask[];
  taskById: Map<string, AgentTeamTaskRecord>;
  agentById: Map<string, AgentTeamAgentRecord>;
  artifactsByTask: Map<string, AgentTeamArtifactRecord[]>;
  orderedTasks: AgentTeamTaskRecord[];
  defaultTask: AgentTeamTaskRecord | undefined;
  rounds: AgentTeamGraphRound[];
  roundOptions: AgentTeamRoundOption[];
}

export interface AgentTeamGraphAgent {
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

interface CreateAgentTeamGraphAgentsOptions {
  phase: AgentTeamPhase;
  plan?: AgentTeamPlanDraft;
  tasks: AgentTeamGraphTask[];
  teammates: AgentTeamAgentRecord[];
  artifacts: AgentTeamArtifactRecord[];
  agentNodeByAgentId: ReadonlyMap<string, CanvasNode & { data: AgentNodeData }>;
  sessions?: Record<string, string>;
}

const metadataNumber = (metadata: Record<string, unknown> | undefined, keys: string[]): number | undefined => {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
};

export const createAgentTeamGraphAgents = ({
  phase,
  plan,
  tasks,
  teammates,
  artifacts,
  agentNodeByAgentId,
  sessions,
}: CreateAgentTeamGraphAgentsOptions): AgentTeamGraphAgent[] => {
  if (phase === 'plan_review' && plan) {
    return plan.teammates.map((teammate) => {
      const ownerKey = `plan:${teammate.name.trim().toLowerCase()}`;
      const ownedTasks = tasks.filter((task) => task.ownerKey === ownerKey);
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

  const taskByKey = new Map(tasks.map((task) => [task.key, task]));
  return teammates.map((agent) => {
    const ownedTasks = tasks.filter((task) => task.ownerKey === `agent:${agent.id}`);
    const currentTask = agent.currentTaskId
      ? taskByKey.get(agent.currentTaskId)
      : ownedTasks.find((task) => task.status === 'in_progress' || task.status === 'needs_input' || task.status === 'needs_review')
        ?? ownedTasks.find((task) => task.status !== 'done' && task.status !== 'failed')
        ?? ownedTasks[0];
    const agentArtifacts = artifacts.filter((artifact) => artifact.agentId === agent.id);
    return {
      key: `agent:${agent.id}`,
      name: agent.name,
      role: agent.role,
      agentType: agentNodeByAgentId.get(agent.id)?.data.agentType
        ?? agent.sessionRef?.provider
        ?? agent.sessionRef?.displayName,
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
      sessionHealth: sessions?.[agent.id],
    };
  });
};

const inferPhase = (snapshot: AgentTeamSnapshot): AgentTeamPhase => {
  if (snapshot.phase) return snapshot.phase;
  const runtime = snapshot.runtime;
  if (runtime.team.status === 'waiting_approval') return 'plan_review';
  if (runtime.agents.some((agent) => agent.role !== 'lead') || runtime.tasks.length > 0) {
    return 'executing';
  }
  return 'briefing';
};

const projectTasks = (
  snapshot: AgentTeamSnapshot,
  phase: AgentTeamPhase,
  orderedTasks: AgentTeamTaskRecord[],
  agentById: Map<string, AgentTeamAgentRecord>,
  taskById: Map<string, AgentTeamTaskRecord>,
  artifactsByTask: Map<string, AgentTeamArtifactRecord[]>,
): AgentTeamGraphTask[] => {
  const plan = snapshot.pendingPlan;
  if (phase === 'plan_review' && plan) {
    return plan.tasks.map((task) => ({
      key: graphKeyFromTitle(task.title),
      title: task.title,
      description: task.description,
      status: 'proposed',
      ownerName: task.ownerName ?? 'Unassigned',
      ownerKey: task.ownerName ? `plan:${graphKeyFromTitle(task.ownerName)}` : undefined,
      depKeys: task.deps.map(graphKeyFromTitle),
      depLabels: task.deps,
      artifactCount: 0,
      updatedAt: plan.updatedAt,
      scope: task.scope,
      verify: task.verify,
      dependencyWarning: task.deps.length === 0
        && DOWNSTREAM_TASK_RE.test(`${task.title} ${task.description}`),
    }));
  }

  return orderedTasks.map((task) => {
    const owner = task.ownerAgentId ? agentById.get(task.ownerAgentId) : undefined;
    return {
      key: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      ownerName: owner?.name ?? 'Any teammate',
      ownerKey: owner ? `agent:${owner.id}` : undefined,
      depKeys: task.deps,
      depLabels: task.deps.map((depId) => taskById.get(depId)?.title ?? depId),
      artifactCount: artifactsByTask.get(task.id)?.length ?? 0,
      updatedAt: task.updatedAt,
      result: task.result,
      blockedReason: task.blockedReason,
      scope: Array.isArray(task.metadata?.scope)
        ? (task.metadata.scope as unknown[]).filter((entry): entry is string => typeof entry === 'string')
        : undefined,
      verify: typeof task.metadata?.verify === 'string' ? task.metadata.verify : undefined,
      sourceTask: task,
    };
  });
};

const groupTaskRounds = (tasks: AgentTeamGraphTask[]): AgentTeamGraphRound[] => {
  const taskByKey = new Map(tasks.map((task) => [task.key, task]));
  const byRound = new Map<number, AgentTeamGraphTask[]>();
  for (const task of tasks) {
    const value = task.sourceTask?.metadata?.round;
    const round = typeof value === 'number' && Number.isFinite(value) && value >= 1
      ? Math.floor(value)
      : 1;
    byRound.set(round, [...(byRound.get(round) ?? []), task]);
  }

  return [...byRound.keys()].sort((left, right) => left - right).map((round) => {
    const roundTasks = byRound.get(round) ?? [];
    const roundKeys = new Set(roundTasks.map((task) => task.key));
    const depthCache = new Map<string, number>();
    const getDepth = (task: AgentTeamGraphTask, seen = new Set<string>()): number => {
      const cached = depthCache.get(task.key);
      if (cached !== undefined) return cached;
      if (seen.has(task.key)) return 0;
      const nextSeen = new Set(seen).add(task.key);
      const depths = task.depKeys
        .filter((key) => roundKeys.has(key))
        .map((key) => taskByKey.get(key))
        .filter((dep): dep is AgentTeamGraphTask => !!dep)
        .map((dep) => getDepth(dep, nextSeen) + 1);
      const depth = depths.length > 0 ? Math.max(...depths) : 0;
      depthCache.set(task.key, depth);
      return depth;
    };
    const columns: AgentTeamGraphTask[][] = [];
    for (const task of roundTasks) {
      const depth = getDepth(task);
      if (!columns[depth]) columns[depth] = [];
      columns[depth].push(task);
    }
    return { round, columns: columns.filter(Boolean) };
  });
};

const createRoundOptions = (rounds: AgentTeamGraphRound[]): AgentTeamRoundOption[] =>
  rounds.map((group) => {
    const tasks = group.columns.flat();
    const doneCount = tasks.filter((task) => task.status === 'done').length;
    const running = tasks.some((task) => (
      task.status === 'in_progress'
      || task.status === 'needs_input'
      || task.status === 'needs_review'
    ));
    const blocked = tasks.some((task) => task.status === 'blocked' || task.status === 'failed');
    const allDone = tasks.length > 0 && doneCount === tasks.length;
    return {
      round: group.round,
      taskCount: tasks.length,
      doneCount,
      status: running ? 'running' : blocked ? 'blocked' : allDone ? 'done' : 'todo',
    };
  });

export const createAgentTeamWorkspaceModel = (
  snapshot: AgentTeamSnapshot,
): AgentTeamWorkspaceModel => {
  const { agents, tasks, artifacts } = snapshot.runtime;
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const artifactsByTask = new Map<string, AgentTeamArtifactRecord[]>();
  for (const artifact of artifacts) {
    if (!artifact.taskId) continue;
    artifactsByTask.set(artifact.taskId, [...(artifactsByTask.get(artifact.taskId) ?? []), artifact]);
  }
  const orderedTasks = [...tasks].sort(
    (left, right) => taskStatusRank(left) - taskStatusRank(right) || left.createdAt - right.createdAt,
  );
  const phase = inferPhase(snapshot);
  const graphTasks = projectTasks(snapshot, phase, orderedTasks, agentById, taskById, artifactsByTask);
  const rounds = groupTaskRounds(graphTasks);
  return {
    phase,
    agents,
    teammates: agents.filter((agent) => agent.role !== 'lead'),
    tasks: graphTasks,
    taskById,
    agentById,
    artifactsByTask,
    orderedTasks,
    defaultTask: orderedTasks.find((task) => task.status !== 'done' && task.status !== 'failed')
      ?? orderedTasks[0],
    rounds,
    roundOptions: createRoundOptions(rounds),
  };
};

const DAG_NODE_WIDTH = 236;
const DAG_NODE_HEIGHT = 58;
const DAG_COLUMN_GAP = 315;
const DAG_ROW_GAP = 76;
const DAG_LEFT = 38;
const DAG_TOP = 92;
const DAG_BOTTOM = 72;
const DAG_MIN_WIDTH = 720;
const DAG_MIN_HEIGHT = 340;
const DAG_ROUND_GAP = 52;
const DAG_ROUND_LABEL_HEIGHT = 28;

export interface AgentTeamDagLayout {
  nodes: Array<{
    task: AgentTeamGraphTask; x: number; y: number; width: number; height: number;
    columnIndex: number; rowIndex: number;
  }>;
  edges: Array<{ key: string; sourceKey: string; targetKey: string; path: string }>;
  stages: Array<{ key: string; x: number; y: number; label: string; index: number }>;
  rounds: Array<{
    key: string; round: number; label: string; top: number; height: number;
    dividerTop: number; labelTop: number; showDivider: boolean; showLabel: boolean;
  }>;
  width: number;
  height: number;
}

export const buildAgentTeamDagLayout = (
  visibleRounds: AgentTeamGraphRound[],
  viewportHeight = 0,
): AgentTeamDagLayout => {
  const showRoundLabels = visibleRounds.length > 1;
  const labelStrip = showRoundLabels ? DAG_ROUND_LABEL_HEIGHT : 0;
  const columnCount = Math.max(1, ...visibleRounds.map((group) => group.columns.length));
  const bandMaxRows = visibleRounds.map((group) =>
    Math.max(1, ...group.columns.map((column) => column.length)),
  );
  const bandHeights = bandMaxRows.map((rows) => (rows - 1) * DAG_ROW_GAP + DAG_NODE_HEIGHT);
  const contentHeight = bandHeights.reduce((sum, height) => sum + height + labelStrip, 0)
    + Math.max(0, visibleRounds.length - 1) * DAG_ROUND_GAP;
  const naturalHeight = DAG_TOP + contentHeight + DAG_BOTTOM;
  const height = Math.max(DAG_MIN_HEIGHT, naturalHeight, viewportHeight);
  const verticalShift = Math.max(0, height - naturalHeight) / 2;
  const nodes: AgentTeamDagLayout['nodes'] = [];
  const rounds: AgentTeamDagLayout['rounds'] = [];
  let cursorY = DAG_TOP + verticalShift;

  visibleRounds.forEach((group, roundIndex) => {
    const labelTop = cursorY;
    const bandTop = cursorY + labelStrip;
    const bandHeight = bandHeights[roundIndex];
    const maxRows = bandMaxRows[roundIndex];
    rounds.push({
      key: `round-${group.round}`, round: group.round, label: `Round ${group.round}`,
      top: bandTop, height: bandHeight, dividerTop: cursorY - DAG_ROUND_GAP / 2,
      labelTop, showDivider: roundIndex > 0, showLabel: showRoundLabels,
    });
    group.columns.forEach((column, columnIndex) => {
      const columnOffset = ((maxRows - column.length) * DAG_ROW_GAP) / 2;
      column.forEach((task, rowIndex) => nodes.push({
        task,
        x: DAG_LEFT + columnIndex * DAG_COLUMN_GAP,
        y: bandTop + columnOffset + rowIndex * DAG_ROW_GAP,
        width: DAG_NODE_WIDTH,
        height: DAG_NODE_HEIGHT,
        columnIndex,
        rowIndex,
      }));
    });
    cursorY = bandTop + bandHeight + DAG_ROUND_GAP;
  });

  const stages = Array.from({ length: columnCount }, (_unused, index) => ({
    key: `stage-${index}`,
    x: DAG_LEFT + index * DAG_COLUMN_GAP + DAG_NODE_WIDTH / 2,
    y: 24 + verticalShift,
    label: index === 0 ? 'Start' : `Stage ${index + 1}`,
    index: index + 1,
  }));
  const nodeByKey = new Map(nodes.map((node) => [node.task.key, node]));
  const roundByKey = new Map<string, number>();
  visibleRounds.forEach((group) => group.columns.forEach((column) => {
    column.forEach((task) => roundByKey.set(task.key, group.round));
  }));
  const edges: AgentTeamDagLayout['edges'] = [];
  for (const node of nodes) {
    for (const depKey of node.task.depKeys) {
      const source = nodeByKey.get(depKey);
      if (!source || roundByKey.get(depKey) !== roundByKey.get(node.task.key)) continue;
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
    rounds,
    width: Math.max(DAG_MIN_WIDTH, DAG_LEFT * 2 + Math.max(0, columnCount - 1) * DAG_COLUMN_GAP + DAG_NODE_WIDTH),
    height,
  };
};
