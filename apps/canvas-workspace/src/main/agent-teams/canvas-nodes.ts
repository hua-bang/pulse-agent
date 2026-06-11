import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { readCanvasFull, writeCanvasFull } from '../canvas/storage';
import { broadcastCanvasUpdate } from '../canvas/broadcast';
import { readWorkspaceMeta } from '../agent/workspace-meta';
import { hasSession, killSession, writeToSession } from '../terminal/pty-manager';
import { sendInputToAgentNode } from '../agent/session-send';
import { autoPlace, INLINE_PROMPT_THRESHOLD } from '../agent/tools/_shared/placement';
import type { CanvasEdge, CanvasNode, CanvasSaveData, EdgeEndpoint } from '../agent/tools/types';

const FRAME_PADDING = 24;
const AGENT_GAP = 24;
const GRID_COLUMNS = 3;
const AGENT_WIDTH = 520;
const AGENT_HEIGHT = 440;
const LEAD_AGENT_HEIGHT = 400;
const FRAME_WIDTH = FRAME_PADDING * 2 + GRID_COLUMNS * AGENT_WIDTH + (GRID_COLUMNS - 1) * AGENT_GAP;
const FRAME_HEIGHT = 840;
const BRIEFING_FRAME_HEIGHT = 780;
// Leads must not delegate to their own subagents (Pulse Canvas owns teammate
// dispatch); file-editing tools stay available because legitimate lead flows
// need them (e.g. writing the plan JSON for propose-plan --plan-file).
// "The lead does not implement tasks" is enforced where pulse-canvas can see
// it: the dispatcher never assigns tasks to the lead, team-protocol actions
// are role-gated server-side, and the lead prompts state the boundary.
const CLAUDE_TEAM_LEAD_ARGS = '--disallowedTools Task';
// Joins messages accumulated for a not-yet-launched agent; also the unit of
// the duplicate check in queueLaunchPrompt.
const QUEUED_PROMPT_SEPARATOR = '\n\n----\n\n';
const TEAM_PANEL_HEIGHT = 388;
const FRAME_HEADER_GAP = TEAM_PANEL_HEIGHT + 24;
const LEGACY_FRAME_HEADER_GAP = 58;

interface CreateTeamNodesInput {
  workspaceId: string;
  teamId: string;
  name: string;
  goal: string;
  cwd?: string;
  lead: { agentId: string; name: string; agentType: string };
  teammates: Array<{ agentId: string; name: string; agentType: string }>;
  x?: number;
  y?: number;
}

interface CreateTeamAgentNodeInput {
  workspaceId: string;
  teamId: string;
  frameNodeId?: string;
  agentId: string;
  name: string;
  role: 'lead' | 'teammate';
  agentType: string;
  cwd?: string;
}

export interface CanvasAgentNodeRef {
  workspaceId: string;
  nodeId: string;
  title: string;
  status: string;
  ptySessionId?: string;
}

const makeNodeId = (): string => `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const makeDefaultCanvas = (): CanvasSaveData => ({
  nodes: [],
  edges: [],
  transform: { x: 0, y: 0, scale: 1 },
  savedAt: new Date().toISOString(),
});

const asNodes = (canvas: CanvasSaveData): CanvasNode[] => {
  canvas.nodes = canvas.nodes ?? [];
  return canvas.nodes;
};

const edgeEndpointReferencesNode = (endpoint: EdgeEndpoint, nodeIds: Set<string>): boolean =>
  endpoint.kind === 'node' && nodeIds.has(endpoint.nodeId);

const loadCanvasOrEmpty = async (workspaceId: string): Promise<CanvasSaveData> => {
  const { data } = await readCanvasFull(workspaceId);
  if (!data) return makeDefaultCanvas();
  return {
    nodes: (data.nodes ?? []) as CanvasNode[],
    edges: data.edges as CanvasSaveData['edges'],
    transform: (data.transform as CanvasSaveData['transform']) ?? { x: 0, y: 0, scale: 1 },
    savedAt: data.savedAt ?? new Date().toISOString(),
  };
};

const resolveCwd = async (workspaceId: string, cwd?: string): Promise<string> => {
  if (cwd) return cwd;
  return (await readWorkspaceMeta(workspaceId)).rootFolder || '';
};

const desiredFrameHeight = (nodes: CanvasNode[], teamId: string): number => {
  const hasTeammates = nodes.some((node) =>
    node.type === 'agent'
    && node.data?.agentTeamId === teamId
    && node.data?.agentTeamRole === 'teammate'
  );
  return hasTeammates ? FRAME_HEIGHT : BRIEFING_FRAME_HEIGHT;
};

const withClaudeTeamLeadArgs = (agentType: string, role: 'lead' | 'teammate', args?: string): string | undefined => {
  if (role !== 'lead' || agentType !== 'claude-code') return args;
  const trimmed = args?.trim();
  if (!trimmed) return CLAUDE_TEAM_LEAD_ARGS;
  return /(^|\s)--disallowed(?:Tools|-tools)(\s|=|$)/.test(trimmed) ? trimmed : `${trimmed} ${CLAUDE_TEAM_LEAD_ARGS}`;
};

const withClaudeCliSessionId = (agentType: unknown, existing: unknown): string | undefined => {
  if (agentType !== 'claude-code') return typeof existing === 'string' ? existing : undefined;
  return typeof existing === 'string' && existing ? existing : randomUUID();
};

const nextQueueRev = (data: Record<string, unknown>): number =>
  (typeof data.queueRev === 'number' && Number.isFinite(data.queueRev) ? data.queueRev : 0) + 1;

const queueLaunchPrompt = async (
  node: CanvasNode,
  prompt: string,
): Promise<void> => {
  const data = node.data ?? {};
  const cwd = typeof data.cwd === 'string' ? data.cwd : '';
  const existingInline = typeof data.inlinePrompt === 'string' ? data.inlinePrompt : '';
  const existingFile = typeof data.promptFile === 'string' ? data.promptFile : '';

  // Read whatever is already queued so consecutive sends ACCUMULATE: a queued
  // task prompt must survive a lead notification that arrives before the
  // agent launches (overwriting used to silently drop the earlier message).
  let queued = existingInline;
  if (existingFile && cwd) {
    try {
      queued = await fs.readFile(join(cwd, existingFile), 'utf-8');
    } catch {
      queued = existingInline;
    }
  }
  // Re-sent nudges are often byte-identical — don't stack copies. Compare
  // whole queued SEGMENTS, not substrings: a short distinct message that
  // happens to appear inside a queued task prompt must still be appended.
  const segments = queued.trim() ? queued.split(QUEUED_PROMPT_SEPARATOR) : [];
  const combined = segments.length === 0
    ? prompt
    : segments.includes(prompt)
      ? queued
      : `${queued}${QUEUED_PROMPT_SEPARATOR}${prompt}`;

  let inlinePrompt = combined;
  let promptFile = '';
  if (combined.length > INLINE_PROMPT_THRESHOLD && cwd) {
    promptFile = existingFile || `.canvas-agent-team-${Date.now()}.md`;
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(join(cwd, promptFile), combined, 'utf-8');
    inlinePrompt = '';
  }

  node.data = {
    ...data,
    status: 'running',
    viewMode: 'running',
    cliSessionId: withClaudeCliSessionId(data.agentType, data.cliSessionId),
    inlinePrompt,
    promptFile,
    lastInitPrompt: combined,
    // Monotonic revision of the main-owned launch-queue fields. The canvas
    // save merge uses it to protect a queued prompt from a renderer save
    // built on a snapshot that predates this write (renderer saves always
    // win the per-node updatedAt race because every renderer touch bumps
    // updatedAt).
    queueRev: nextQueueRev(data),
  };
  node.updatedAt = Date.now();
};

const makeAgentNode = async (
  workspaceId: string,
  input: Omit<CreateTeamAgentNodeInput, 'workspaceId' | 'frameNodeId'> & { x: number; y: number; cwd?: string },
): Promise<CanvasNode> => {
  const cwd = await resolveCwd(workspaceId, input.cwd);
  return {
    id: makeNodeId(),
    type: 'agent',
    title: input.name,
    x: input.x,
    y: input.y,
    width: AGENT_WIDTH,
    height: input.role === 'lead' ? LEAD_AGENT_HEIGHT : AGENT_HEIGHT,
    data: {
      sessionId: '',
      cwd,
      agentType: input.agentType,
      agentArgs: withClaudeTeamLeadArgs(input.agentType, input.role),
      dangerousMode: true,
      cliSessionId: withClaudeCliSessionId(input.agentType, undefined),
      status: 'idle',
      viewMode: 'setup',
      agentTeamId: input.teamId,
      agentTeamAgentId: input.agentId,
      agentTeamRole: input.role,
    },
    updatedAt: Date.now(),
  };
};

export async function createAgentTeamCanvasNodes(input: CreateTeamNodesInput): Promise<{
  frameNodeId: string;
  agentNodeIds: Record<string, string>;
}> {
  const canvas = await loadCanvasOrEmpty(input.workspaceId);
  const nodes = asNodes(canvas);
  const pos = input.x != null && input.y != null
    ? { x: input.x, y: input.y }
    : autoPlace(nodes);
  const frameNodeId = makeNodeId();
  const now = Date.now();

  const frame: CanvasNode = {
    id: frameNodeId,
    type: 'frame',
    title: input.name,
    x: pos.x,
    y: pos.y,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    data: {
      color: '#7AA7E8',
      label: input.goal,
      agentTeamId: input.teamId,
      agentTeamName: input.name,
      agentTeamGoal: input.goal,
      agentTeamPanelHeight: TEAM_PANEL_HEIGHT,
    },
    updatedAt: now,
  };

  const agentSpecs = [
    { ...input.lead, role: 'lead' as const },
    ...input.teammates.map((agent) => ({ ...agent, role: 'teammate' as const })),
  ];
  const agentNodeIds: Record<string, string> = {};
  const agentNodes: CanvasNode[] = [];
  for (let index = 0; index < agentSpecs.length; index += 1) {
    const spec = agentSpecs[index];
    const col = index % GRID_COLUMNS;
    const row = Math.floor(index / GRID_COLUMNS);
    const agentNode = await makeAgentNode(input.workspaceId, {
      teamId: input.teamId,
      agentId: spec.agentId,
      name: spec.name,
      role: spec.role,
      agentType: spec.agentType,
      cwd: input.cwd,
      x: frame.x + FRAME_PADDING + col * (AGENT_WIDTH + AGENT_GAP),
      y: frame.y + FRAME_HEADER_GAP + row * (AGENT_HEIGHT + AGENT_GAP),
    });
    agentNodeIds[spec.agentId] = agentNode.id;
    agentNodes.push(agentNode);
  }

  frame.height = input.teammates.length === 0 ? BRIEFING_FRAME_HEIGHT : FRAME_HEIGHT;

  canvas.nodes = [...nodes, frame, ...agentNodes];
  await writeCanvasFull(input.workspaceId, canvas);
  broadcastCanvasUpdate(input.workspaceId, [frame.id, ...agentNodes.map((node) => node.id)], 'create', 'agent-teams');
  return { frameNodeId, agentNodeIds };
}

export async function createTeamAgentNode(input: CreateTeamAgentNodeInput): Promise<string> {
  const canvas = await loadCanvasOrEmpty(input.workspaceId);
  const nodes = asNodes(canvas);
  const frame = input.frameNodeId ? nodes.find((node) => node.id === input.frameNodeId) : undefined;
  const teammateCount = nodes.filter((node) =>
    node.type === 'agent'
    && node.data?.agentTeamId === input.teamId
    && node.data?.agentTeamRole === 'teammate'
  ).length;
  const slot = input.role === 'lead' ? 0 : teammateCount + 1;
  const col = slot % GRID_COLUMNS;
  const row = Math.floor(slot / GRID_COLUMNS);
  const placed = autoPlace(nodes);
  const base = frame ?? {
    x: placed.x,
    y: placed.y,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
  };
  const panelHeight = typeof frame?.data?.agentTeamPanelHeight === 'number'
    ? frame.data.agentTeamPanelHeight
    : TEAM_PANEL_HEIGHT;

  const agentNode = await makeAgentNode(input.workspaceId, {
    teamId: input.teamId,
    agentId: input.agentId,
    name: input.name,
    role: input.role,
    agentType: input.agentType,
    cwd: input.cwd,
    x: base.x + FRAME_PADDING + col * (AGENT_WIDTH + AGENT_GAP),
    y: base.y + panelHeight + 24 + row * (AGENT_HEIGHT + AGENT_GAP),
  });

  if (frame) {
    const requiredRight = agentNode.x + agentNode.width + FRAME_PADDING;
    const targetHeight = Math.max(frame.height ?? FRAME_HEIGHT, FRAME_HEIGHT);
    if (frame.height !== targetHeight) {
      frame.height = targetHeight;
      frame.updatedAt = Date.now();
    }
    if (requiredRight > frame.x + (frame.width ?? FRAME_WIDTH)) {
      frame.width = requiredRight - frame.x;
      frame.updatedAt = Date.now();
    }
  }

  canvas.nodes = [...nodes, agentNode];
  await writeCanvasFull(input.workspaceId, canvas);
  broadcastCanvasUpdate(input.workspaceId, [agentNode.id, ...(frame ? [frame.id] : [])], 'create', 'agent-teams');
  return agentNode.id;
}

export async function ensureAgentTeamCanvasLayout(workspaceId: string, teamId: string): Promise<void> {
  const canvas = await loadCanvasOrEmpty(workspaceId);
  const nodes = asNodes(canvas);
  const frame = nodes.find((node) => node.type === 'frame' && node.data?.agentTeamId === teamId);
  if (!frame) return;

  const currentPanelHeight = typeof frame.data?.agentTeamPanelHeight === 'number'
    ? frame.data.agentTeamPanelHeight
    : undefined;
  if (currentPanelHeight === TEAM_PANEL_HEIGHT) {
    let changed = ensureTeamAgentLaunchDefaults(nodes, teamId);
    const minHeight = desiredFrameHeight(nodes, teamId);
    if ((frame.height ?? 0) < minHeight) {
      frame.height = minHeight;
      frame.updatedAt = Date.now();
      changed = true;
    }

    if (changed) {
      await writeCanvasFull(workspaceId, canvas);
      broadcastCanvasUpdate(
        workspaceId,
        nodes.filter((node) => node.data?.agentTeamId === teamId).map((node) => node.id),
        'update',
        'agent-teams',
      );
    }
    return;
  }

  const oldGap = currentPanelHeight != null
    ? currentPanelHeight + 24
    : LEGACY_FRAME_HEADER_GAP;
  const delta = FRAME_HEADER_GAP - oldGap;
  frame.data = {
    ...frame.data,
    agentTeamPanelHeight: TEAM_PANEL_HEIGHT,
  };
  if (delta > 0) {
    frame.height = (frame.height ?? FRAME_HEIGHT) + delta;
  }
  frame.updatedAt = Date.now();

  for (const node of nodes) {
    if (node.type !== 'agent' || node.data?.agentTeamId !== teamId) continue;
    node.y += delta;
    node.updatedAt = Date.now();
  }

  if (currentPanelHeight == null) {
    compactLeaderOnlyLayout(nodes, frame, teamId);
  }
  ensureTeamAgentLaunchDefaults(nodes, teamId);
  const minHeight = desiredFrameHeight(nodes, teamId);
  if ((frame.height ?? 0) < minHeight) {
    frame.height = minHeight;
    frame.updatedAt = Date.now();
  }

  await writeCanvasFull(workspaceId, canvas);
  broadcastCanvasUpdate(
    workspaceId,
    nodes.filter((node) => node.id === frame.id || node.data?.agentTeamId === teamId).map((node) => node.id),
    'update',
    'agent-teams',
  );
}

export async function stopAgentTeamCanvasNodes(workspaceId: string, teamId: string): Promise<string[]> {
  const canvas = await loadCanvasOrEmpty(workspaceId);
  const nodes = asNodes(canvas);
  const changedIds: string[] = [];
  const now = Date.now();

  for (const node of nodes) {
    if (node.type !== 'agent' || node.data?.agentTeamId !== teamId) continue;
    node.data = {
      ...node.data,
      status: 'idle',
      viewMode: 'restart',
      inlinePrompt: '',
      promptFile: '',
    };
    node.updatedAt = now;
    changedIds.push(node.id);
  }

  if (changedIds.length === 0) return [];
  await writeCanvasFull(workspaceId, canvas);
  broadcastCanvasUpdate(workspaceId, changedIds, 'update', 'agent-teams');
  return changedIds;
}

export async function updateAgentTeamCanvasCwd(workspaceId: string, teamId: string, cwd: string): Promise<string[]> {
  const canvas = await loadCanvasOrEmpty(workspaceId);
  const nodes = asNodes(canvas);
  const changedIds: string[] = [];
  const now = Date.now();

  for (const node of nodes) {
    if (node.type !== 'agent' || node.data?.agentTeamId !== teamId) continue;
    if (node.data.cwd === cwd) continue;
    // Queued launch-prompt files live under the node's cwd; moving the cwd
    // without moving the file would silently drop everything queued for a
    // not-yet-launched agent the next time queueLaunchPrompt reads it.
    const promptFile = typeof node.data.promptFile === 'string' ? node.data.promptFile : '';
    const oldCwd = typeof node.data.cwd === 'string' ? node.data.cwd : '';
    if (promptFile && oldCwd) {
      try {
        const content = await fs.readFile(join(oldCwd, promptFile), 'utf-8');
        await fs.mkdir(cwd, { recursive: true });
        await fs.writeFile(join(cwd, promptFile), content, 'utf-8');
        await fs.unlink(join(oldCwd, promptFile)).catch(() => {});
      } catch {
        // Best effort — the original file may already be gone.
      }
    }
    node.data = {
      ...node.data,
      cwd,
    };
    node.updatedAt = now;
    changedIds.push(node.id);
  }

  if (changedIds.length === 0) return [];
  await writeCanvasFull(workspaceId, canvas);
  broadcastCanvasUpdate(workspaceId, changedIds, 'update', 'agent-teams');
  return changedIds;
}

export async function removeAgentTeamCanvasNodes(
  workspaceId: string,
  teamId: string,
  knownNodeIds: string[] = [],
): Promise<string[]> {
  const canvas = await loadCanvasOrEmpty(workspaceId);
  const nodes = asNodes(canvas);
  const knownNodeIdSet = new Set(knownNodeIds);
  const removedIds = nodes
    .filter((node) => node.data?.agentTeamId === teamId || knownNodeIdSet.has(node.id))
    .map((node) => node.id);
  if (removedIds.length === 0) return [];

  const removedIdSet = new Set(removedIds);
  canvas.nodes = nodes.filter((node) => !removedIdSet.has(node.id));
  canvas.edges = (canvas.edges ?? []).filter((edge: CanvasEdge) =>
    !edgeEndpointReferencesNode(edge.source, removedIdSet)
    && !edgeEndpointReferencesNode(edge.target, removedIdSet)
  );
  canvas.savedAt = new Date().toISOString();
  await writeCanvasFull(workspaceId, canvas);
  broadcastCanvasUpdate(workspaceId, removedIds, 'delete', 'agent-teams');
  return removedIds;
}

function compactLeaderOnlyLayout(nodes: CanvasNode[], frame: CanvasNode, teamId: string): boolean {
  const teamAgents = nodes.filter((node) => node.type === 'agent' && node.data?.agentTeamId === teamId);
  if (teamAgents.length !== 1 || teamAgents[0].data?.agentTeamRole !== 'lead') return false;

  const lead = teamAgents[0];
  let changed = false;
  const targetY = frame.y + FRAME_HEADER_GAP;
  const targetHeight = LEAD_AGENT_HEIGHT;
  if (lead.y !== targetY) {
    lead.y = targetY;
    changed = true;
  }
  if (lead.height !== targetHeight) {
    lead.height = targetHeight;
    changed = true;
  }

  const requiredFrameHeight = Math.max(
    BRIEFING_FRAME_HEIGHT,
    lead.y + lead.height - frame.y + FRAME_PADDING,
  );
  if (frame.height !== requiredFrameHeight) {
    frame.height = requiredFrameHeight;
    changed = true;
  }

  if (changed) {
    const now = Date.now();
    lead.updatedAt = now;
    frame.updatedAt = now;
  }
  return changed;
}

function ensureTeamAgentLaunchDefaults(nodes: CanvasNode[], teamId: string): boolean {
  let changed = false;
  for (const node of nodes) {
    if (node.type !== 'agent' || node.data?.agentTeamId !== teamId) continue;
    let nextArgs = typeof node.data.agentArgs === 'string' ? node.data.agentArgs : undefined;
    if (node.data?.agentTeamRole === 'lead' && node.data?.agentType === 'claude-code') {
      nextArgs = withClaudeTeamLeadArgs('claude-code', 'lead', nextArgs);
    }

    const nextDangerousMode = true;
    if (nextArgs === node.data.agentArgs && node.data.dangerousMode === nextDangerousMode) continue;
    node.data = {
      ...node.data,
      agentArgs: nextArgs,
      dangerousMode: nextDangerousMode,
    };
    node.updatedAt = Date.now();
    changed = true;
  }
  return changed;
}

export async function getCanvasAgentNode(workspaceId: string, nodeId: string): Promise<CanvasAgentNodeRef | undefined> {
  const { data: canvas } = await readCanvasFull(workspaceId);
  const node = canvas?.nodes?.find((item) => item.id === nodeId);
  if (!node || node.type !== 'agent') return undefined;
  const ptySessionId = typeof node.data?.sessionId === 'string' ? node.data.sessionId : undefined;
  return {
    workspaceId,
    nodeId,
    title: node.title ?? nodeId,
    status: typeof node.data?.status === 'string' ? node.data.status : 'idle',
    ptySessionId,
  };
}

export interface CanvasAgentNodeRuntimeState {
  exists: boolean;
  status: string;
  /** Whether the node's recorded PTY session is alive in this process. */
  ptyAlive: boolean;
  /** Whether a launch prompt is queued, waiting for the renderer to spawn. */
  hasQueuedLaunch: boolean;
}

export async function getCanvasAgentNodeRuntimeState(
  workspaceId: string,
  nodeId: string,
): Promise<CanvasAgentNodeRuntimeState> {
  const { data: canvas } = await readCanvasFull(workspaceId);
  const node = canvas?.nodes?.find((item) => item.id === nodeId);
  if (!node || node.type !== 'agent') {
    return { exists: false, status: 'missing', ptyAlive: false, hasQueuedLaunch: false };
  }
  const ptySessionId = typeof node.data?.sessionId === 'string' ? node.data.sessionId : '';
  const inlinePrompt = typeof node.data?.inlinePrompt === 'string' ? node.data.inlinePrompt : '';
  const promptFile = typeof node.data?.promptFile === 'string' ? node.data.promptFile : '';
  return {
    exists: true,
    status: typeof node.data?.status === 'string' ? node.data.status : 'idle',
    ptyAlive: !!ptySessionId && hasSession(ptySessionId),
    hasQueuedLaunch: !!(inlinePrompt || promptFile),
  };
}

/**
 * Batch variant of getCanvasAgentNodeRuntimeState: one canvas read serves
 * every agent of a team, instead of the watchdog re-reading canvas.json from
 * disk once per agent per heartbeat tick.
 */
export async function getCanvasAgentNodesRuntimeState(
  workspaceId: string,
  nodeIds: string[],
): Promise<Map<string, CanvasAgentNodeRuntimeState>> {
  const result = new Map<string, CanvasAgentNodeRuntimeState>();
  if (nodeIds.length === 0) return result;
  const { data: canvas } = await readCanvasFull(workspaceId);
  for (const nodeId of nodeIds) {
    const node = canvas?.nodes?.find((item) => item.id === nodeId);
    if (!node || node.type !== 'agent') {
      result.set(nodeId, { exists: false, status: 'missing', ptyAlive: false, hasQueuedLaunch: false });
      continue;
    }
    const ptySessionId = typeof node.data?.sessionId === 'string' ? node.data.sessionId : '';
    const inlinePrompt = typeof node.data?.inlinePrompt === 'string' ? node.data.inlinePrompt : '';
    const promptFile = typeof node.data?.promptFile === 'string' ? node.data.promptFile : '';
    result.set(nodeId, {
      exists: true,
      status: typeof node.data?.status === 'string' ? node.data.status : 'idle',
      ptyAlive: !!ptySessionId && hasSession(ptySessionId),
      hasQueuedLaunch: !!(inlinePrompt || promptFile),
    });
  }
  return result;
}

export async function sendOrQueueAgentInput(workspaceId: string, nodeId: string, input: string): Promise<void> {
  const ref = await getCanvasAgentNode(workspaceId, nodeId);
  if (ref?.ptySessionId && ref.status === 'running' && hasSession(ref.ptySessionId)) {
    const result = await sendInputToAgentNode({ workspaceId, nodeId, input });
    if (result.ok) return;
  }

  const canvas = await loadCanvasOrEmpty(workspaceId);
  const node = canvas.nodes?.find((item) => item.id === nodeId);
  if (!node || node.type !== 'agent') {
    throw new Error(`Agent node not found: ${nodeId}`);
  }
  await queueLaunchPrompt(node, input);
  await writeCanvasFull(workspaceId, canvas);
  broadcastCanvasUpdate(workspaceId, [nodeId], 'update', 'agent-teams');
}

/**
 * Persist the prompt that a restart/relaunch of this agent node should replay.
 *
 * When a teammate finishes a task and the next one is delivered into its live
 * PTY session, the inline-send path does not touch `lastInitPrompt`, so it keeps
 * pointing at the previous (now finished) task. A later restart that cannot
 * resume the CLI conversation would then replay that stale prompt and redo the
 * completed task. Updating `lastInitPrompt` on each dispatch keeps a restart
 * aligned with the agent's current task.
 */
export async function persistAgentNodeLaunchPrompt(
  workspaceId: string,
  nodeId: string,
  prompt: string,
): Promise<void> {
  const canvas = await loadCanvasOrEmpty(workspaceId);
  const node = canvas.nodes?.find((item) => item.id === nodeId);
  if (!node || node.type !== 'agent') return;
  if (node.data?.lastInitPrompt === prompt) return;
  node.data = { ...node.data, lastInitPrompt: prompt, queueRev: nextQueueRev(node.data ?? {}) };
  node.updatedAt = Date.now();
  await writeCanvasFull(workspaceId, canvas);
  broadcastCanvasUpdate(workspaceId, [nodeId], 'update', 'agent-teams');
}

export async function interruptCanvasAgentNode(
  workspaceId: string,
  nodeId: string,
  mode: 'soft' | 'ctrl-c' | 'abort',
): Promise<void> {
  const ref = await getCanvasAgentNode(workspaceId, nodeId);
  if (!ref?.ptySessionId || !hasSession(ref.ptySessionId)) return;
  if (mode === 'ctrl-c' || mode === 'soft') {
    writeToSession(ref.ptySessionId, '\x03');
    return;
  }
  killSession(ref.ptySessionId);
}
