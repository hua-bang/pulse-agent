import {
  GLOBAL_CHAT_STORE_ID,
  scheduledTaskIdFromStoreId,
} from '../../shared/agent-chat';
import type { CanvasNode, CanvasSaveData } from '../agent/tools/types';
import { listWorkspaces, type WorkspaceInfo } from '../canvas/workspaces';
import { listWorkspaceNodes, type WorkspaceNodeRecord } from '../canvas/nodes/store';
import { loadCanvas } from '../agent/tools/_shared/canvas-io';
import {
  GLOBAL_CHAT_WORKSPACE_NAME,
  SessionStore,
  type SessionWithMeta,
} from '../agent/sessions/store/session-store';

/** Node types whose `updatedAt` bumps on background output rather than content edits. */
const TRANSIENT_NODE_TYPES = new Set(['terminal', 'agent']);

const MAX_SESSIONS_PER_WORKSPACE = 12;
const MAX_MESSAGES_PER_SESSION = 8;
const MAX_CANVAS_CHANGES_PER_WORKSPACE = 20;

export interface CollectedSessionActivity {
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  date: string;
  lastActivityAt: number;
  messageCount: number;
  ref: string;
  excerpts: Array<{ role: string; text: string }>;
}

export interface CollectedCanvasChange {
  nodeId: string;
  type: string;
  title: string;
  changeKind: 'created' | 'updated';
  timestamp: number;
  snippet: string;
}

export interface WorkspaceActivityBucket {
  workspaceId: string;
  workspaceName: string;
  sessions: CollectedSessionActivity[];
  canvasChanges: CollectedCanvasChange[];
}

export interface CanvasActivitySnapshot {
  days: number;
  cutoffMs: number;
  collectedAt: number;
  hasActivity: boolean;
  activeWorkspaceCount: number;
  totalSessions: number;
  totalCanvasChanges: number;
  workspaces: WorkspaceActivityBucket[];
}

export interface ActivityCollectorDeps {
  listWorkspaces: () => Promise<{ workspaces: WorkspaceInfo[] }>;
  readAllSessions: () => Promise<SessionWithMeta[]>;
  loadCanvas: (workspaceId: string) => Promise<CanvasSaveData | null>;
  listWorkspaceNodes: (workspaceId: string) => Promise<WorkspaceNodeRecord[]>;
}

const defaultDeps: ActivityCollectorDeps = {
  listWorkspaces: () => listWorkspaces(),
  readAllSessions: () => SessionStore.readAllSessionsWithMeta(),
  loadCanvas: (workspaceId) => loadCanvas(workspaceId),
  listWorkspaceNodes: (workspaceId) => listWorkspaceNodes(workspaceId),
};

function trimText(value: unknown, max = 180): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function sessionLastActivityMs(entry: SessionWithMeta): number {
  const messages = entry.session.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const ts = messages[i]?.timestamp;
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  }
  const started = Date.parse(entry.session.startedAt ?? '');
  return Number.isFinite(started) ? started : entry.sortKey;
}

function extractNodeSnippet(node?: CanvasNode, record?: WorkspaceNodeRecord): string {
  const candidates: unknown[] = [
    record?.properties?.summary,
    record?.data?.content,
    record?.data?.url,
    record?.data?.filePath,
    node?.data?.content,
    node?.data?.label,
    node?.data?.url,
    node?.data?.filePath,
    node?.data?.prompt,
  ];
  for (const candidate of candidates) {
    const text = trimText(candidate, 140);
    if (text) return text;
  }
  return '';
}

function resolveNodeTitle(node?: CanvasNode, record?: WorkspaceNodeRecord): string {
  const raw = record?.title || node?.title || (typeof node?.data?.label === 'string' ? node.data.label : '');
  const trimmed = trimText(raw, 80);
  return trimmed || `${record?.type ?? node?.type ?? 'node'} (${(record?.id ?? node?.id ?? '').slice(0, 8)})`;
}

function collectWorkspaceCanvasChanges(
  canvas: CanvasSaveData | null,
  records: WorkspaceNodeRecord[],
  cutoffMs: number,
): CollectedCanvasChange[] {
  const nodesById = new Map<string, CanvasNode>();
  for (const node of canvas?.nodes ?? []) {
    if (node?.id) nodesById.set(node.id, node);
  }
  const recordsById = new Map<string, WorkspaceNodeRecord>();
  for (const record of records) {
    if (record?.id) recordsById.set(record.id, record);
  }

  const allIds = new Set<string>([...nodesById.keys(), ...recordsById.keys()]);
  const changes: CollectedCanvasChange[] = [];

  for (const id of allIds) {
    const node = nodesById.get(id);
    const record = recordsById.get(id);
    const type = record?.type ?? node?.type ?? 'unknown';
    if (TRANSIENT_NODE_TYPES.has(type)) continue;

    const nodeMeta = node as (CanvasNode & { createdAt?: unknown; updatedAt?: unknown }) | undefined;
    const createdAt = Math.max(
      typeof nodeMeta?.createdAt === 'number' ? nodeMeta.createdAt : 0,
      typeof record?.createdAt === 'number' ? record.createdAt : 0,
    );
    const updatedAt = Math.max(
      typeof nodeMeta?.updatedAt === 'number' ? nodeMeta.updatedAt : 0,
      typeof record?.updatedAt === 'number' ? record.updatedAt : 0,
      createdAt,
    );

    if (updatedAt < cutoffMs) continue;

    const changeKind: 'created' | 'updated' = createdAt >= cutoffMs ? 'created' : 'updated';
    changes.push({
      nodeId: id,
      type,
      title: resolveNodeTitle(node, record),
      changeKind,
      timestamp: updatedAt,
      snippet: extractNodeSnippet(node, record),
    });
  }

  return changes
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_CANVAS_CHANGES_PER_WORKSPACE);
}

/**
 * Collects cross-workspace chat sessions and substantive canvas node changes
 * within the last `days` days. Read-only and safe to run on a fast path before
 * invoking the LLM.
 */
export async function collectCanvasActivity(
  options: { days: number; now?: number; deps?: Partial<ActivityCollectorDeps> },
): Promise<CanvasActivitySnapshot> {
  const deps: ActivityCollectorDeps = { ...defaultDeps, ...options.deps };
  const days = Math.max(1, options.days);
  const collectedAt = options.now ?? Date.now();
  const cutoffMs = collectedAt - days * 86_400_000;

  const [{ workspaces }, allSessions] = await Promise.all([
    deps.listWorkspaces(),
    deps.readAllSessions(),
  ]);

  const buckets = new Map<string, WorkspaceActivityBucket>();
  const ensureBucket = (workspaceId: string, workspaceName: string): WorkspaceActivityBucket => {
    const existing = buckets.get(workspaceId);
    if (existing) return existing;
    const created: WorkspaceActivityBucket = {
      workspaceId,
      workspaceName,
      sessions: [],
      canvasChanges: [],
    };
    buckets.set(workspaceId, created);
    return created;
  };

  for (const ws of workspaces) {
    ensureBucket(ws.id, ws.name);
  }

  for (const entry of allSessions) {
    const wsId = entry.session.workspaceId;
    if (scheduledTaskIdFromStoreId(wsId) !== null) continue;
    const messages = entry.session.messages ?? [];
    if (messages.length === 0) continue;

    const lastActivityAt = sessionLastActivityMs(entry);
    if (lastActivityAt < cutoffMs) continue;

    const wsName = wsId === GLOBAL_CHAT_STORE_ID
      ? GLOBAL_CHAT_WORKSPACE_NAME
      : (entry.workspaceName || wsId);
    const bucket = ensureBucket(wsId, wsName);
    const date = new Date(lastActivityAt).toISOString().slice(0, 10);
    const label = `${wsName} ${date}`.trim();
    const recent = messages.slice(-MAX_MESSAGES_PER_SESSION);

    bucket.sessions.push({
      sessionId: entry.session.sessionId,
      workspaceId: wsId,
      workspaceName: wsName,
      date,
      lastActivityAt,
      messageCount: messages.length,
      ref: `@[session:${wsId}:${entry.session.sessionId}:|${label}]`,
      excerpts: recent
        .map((m) => ({ role: m.role, text: trimText(m.content, 200) }))
        .filter((m) => m.text.length > 0),
    });
  }

  for (const bucket of buckets.values()) {
    bucket.sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    bucket.sessions = bucket.sessions.slice(0, MAX_SESSIONS_PER_WORKSPACE);
  }

  await Promise.all(
    workspaces.map(async (ws) => {
      try {
        const [canvas, records] = await Promise.all([
          deps.loadCanvas(ws.id).catch(() => null),
          deps.listWorkspaceNodes(ws.id).catch(() => []),
        ]);
        const changes = collectWorkspaceCanvasChanges(canvas, records, cutoffMs);
        if (changes.length > 0) {
          ensureBucket(ws.id, ws.name).canvasChanges = changes;
        }
      } catch {
        // Ignore unreadable workspace stores; other workspaces still summarize.
      }
    }),
  );

  const activeWorkspaces = [...buckets.values()]
    .filter((b) => b.sessions.length > 0 || b.canvasChanges.length > 0)
    .sort((a, b) => (b.sessions.length + b.canvasChanges.length) - (a.sessions.length + a.canvasChanges.length));

  const totalSessions = activeWorkspaces.reduce((sum, b) => sum + b.sessions.length, 0);
  const totalCanvasChanges = activeWorkspaces.reduce((sum, b) => sum + b.canvasChanges.length, 0);

  return {
    days,
    cutoffMs,
    collectedAt,
    hasActivity: totalSessions > 0 || totalCanvasChanges > 0,
    activeWorkspaceCount: activeWorkspaces.length,
    totalSessions,
    totalCanvasChanges,
    workspaces: activeWorkspaces,
  };
}

/** Compact markdown digest injected into the scheduled summary prompt. */
export function formatActivityForPrompt(snapshot: CanvasActivitySnapshot): string {
  if (!snapshot.hasActivity) {
    return `(No chat sessions or substantive canvas changes recorded in the last ${snapshot.days} day(s).)`;
  }

  const lines: string[] = [
    `Window: last ${snapshot.days} day(s) — ${snapshot.activeWorkspaceCount} active workspace(s), ${snapshot.totalSessions} session(s), ${snapshot.totalCanvasChanges} canvas change(s).`,
    '',
  ];

  for (const ws of snapshot.workspaces) {
    lines.push(`### Workspace: ${ws.workspaceName} (${ws.workspaceId})`);
    if (ws.sessions.length > 0) {
      lines.push(`Sessions (${ws.sessions.length}):`);
      for (const s of ws.sessions) {
        lines.push(`- ${s.ref} (${s.messageCount} msgs, ${s.date})`);
        for (const ex of s.excerpts.slice(-4)) {
          lines.push(`  - ${ex.role}: ${ex.text}`);
        }
      }
    }
    if (ws.canvasChanges.length > 0) {
      lines.push(`Canvas changes (${ws.canvasChanges.length}):`);
      for (const c of ws.canvasChanges) {
        const preview = c.snippet ? ` — ${c.snippet}` : '';
        lines.push(`- [${c.changeKind}] (${c.type}) ${c.title} [node:${c.nodeId}]${preview}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

/** Short factual summary shown in the completion toast. */
export function formatActivityBrief(snapshot: CanvasActivitySnapshot): string {
  if (!snapshot.hasActivity) return 'No new activity';
  return `${snapshot.activeWorkspaceCount} workspaces · ${snapshot.totalSessions} sessions · ${snapshot.totalCanvasChanges} canvas changes`;
}
