import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { resolveRemoteFilePath } from './auth.js';

export type ShareRole = 'viewer' | 'editor' | 'collaborator';

export interface ShareTokenRecord {
  id: string;
  token: string;
  workspaceId: string;
  role: ShareRole;
  label?: string;
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
}

export interface ShareTokenSummary {
  id: string;
  workspaceId: string;
  role: ShareRole;
  label?: string;
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
  tokenPreview: string;
}

export type AuthPrincipal =
  | { kind: 'admin' }
  | { kind: 'share'; share: ShareTokenRecord };

const VALID_ROLES = new Set<ShareRole>(['viewer', 'editor', 'collaborator']);

const READ_ONLY_RPC_METHODS = new Set([
  'canvas.read',
  'canvas.readNode',
  'canvas.listNodes',
  'workspaces.getTrashed',
  'conversations.read',
  'conversations.list',
  'conversationScopes.read',
  'changes.read',
  'changes.latestCursor',
]);

const EDITOR_RPC_METHODS = new Set([
  ...READ_ONLY_RPC_METHODS,
  'canvas.commit',
  'conversations.commit',
  'conversationScopes.commit',
  'fileWrites.get',
  'fileWrites.list',
  'fileWrites.settle',
]);

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isValidShareRole(role: unknown): role is ShareRole {
  return typeof role === 'string' && VALID_ROLES.has(role as ShareRole);
}

export function isSafeWorkspaceId(workspaceId: unknown): workspaceId is string {
  if (typeof workspaceId !== 'string') return false;
  const trimmed = workspaceId.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return false;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0') || trimmed.includes('..')) {
    return false;
  }
  return true;
}

function toSummary(record: ShareTokenRecord): ShareTokenSummary {
  const preview =
    record.token.length > 12
      ? `${record.token.slice(0, 8)}...${record.token.slice(-4)}`
      : record.token;
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    role: record.role,
    label: record.label,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    tokenPreview: preview,
  };
}

const LAST_USED_PERSIST_INTERVAL_MS = 60_000;

export class ShareTokenStore {
  private readonly filePath: string;
  private records: ShareTokenRecord[] = [];
  private lastPersistedUsageAt = 0;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'share-tokens.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        this.records = parsed.filter(
          (item): item is ShareTokenRecord =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as ShareTokenRecord).id === 'string' &&
            typeof (item as ShareTokenRecord).token === 'string' &&
            isSafeWorkspaceId((item as ShareTokenRecord).workspaceId) &&
            isValidShareRole((item as ShareTokenRecord).role),
        );
      }
    } catch {
      this.records = [];
    }
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.records, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.filePath);
  }

  private isExpired(record: ShareTokenRecord): boolean {
    return typeof record.expiresAt === 'number' && Date.now() > record.expiresAt;
  }

  authenticate(req: IncomingMessage, adminToken: string): AuthPrincipal | null {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const provided = header.slice('Bearer '.length).trim();
    if (!provided) return null;
    if (safeEqual(provided, adminToken)) {
      return { kind: 'admin' };
    }
    for (const record of this.records) {
      if (this.isExpired(record)) continue;
      if (safeEqual(provided, record.token)) {
        const now = Date.now();
        record.lastUsedAt = now;
        if (now - this.lastPersistedUsageAt > LAST_USED_PERSIST_INTERVAL_MS) {
          this.lastPersistedUsageAt = now;
          void this.persist().catch(() => undefined);
        }
        return { kind: 'share', share: record };
      }
    }
    return null;
  }

  list(workspaceId?: string): ShareTokenSummary[] {
    return this.records
      .filter((r) => !this.isExpired(r) && (!workspaceId || r.workspaceId === workspaceId))
      .map(toSummary);
  }

  async create(input: {
    workspaceId: string;
    role: ShareRole;
    label?: string;
    expiresInHours?: number;
  }): Promise<ShareTokenRecord> {
    const workspaceId = input.workspaceId.trim();
    if (!isSafeWorkspaceId(workspaceId)) {
      throw new Error('Invalid workspaceId');
    }
    const now = Date.now();
    const record: ShareTokenRecord = {
      id: `sh_${randomBytes(6).toString('hex')}`,
      token: `pst_${randomBytes(24).toString('hex')}`,
      workspaceId,
      role: input.role,
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
      createdAt: now,
      ...(typeof input.expiresInHours === 'number' && input.expiresInHours > 0
        ? { expiresAt: now + Math.round(input.expiresInHours * 3600_000) }
        : {}),
    };
    this.records.push(record);
    await this.persist();
    return record;
  }

  async revoke(id: string): Promise<boolean> {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    if (this.records.length === before) return false;
    await this.persist();
    return true;
  }
}

export function canWriteWorkspace(principal: AuthPrincipal): boolean {
  if (principal.kind === 'admin') return true;
  return principal.share.role === 'editor' || principal.share.role === 'collaborator';
}

export function canUseRuntime(principal: AuthPrincipal): boolean {
  if (principal.kind === 'admin') return true;
  return principal.share.role === 'collaborator';
}

export function isRemoteFileUriAllowed(
  principal: AuthPrincipal,
  uri: string,
  dataDir = '/',
): boolean {
  if (principal.kind === 'admin') return true;
  if (!isSafeWorkspaceId(principal.share.workspaceId)) return false;
  const resolved = resolveRemoteFilePath(dataDir, uri);
  if (!resolved) return false;
  const wsRoot = resolve(dataDir, principal.share.workspaceId);
  const rel = relative(wsRoot, resolved);
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

export function isRpcCallAllowed(
  principal: AuthPrincipal,
  method: string,
  args: unknown[],
): boolean {
  if (principal.kind === 'admin') return true;
  const allowedMethods =
    principal.share.role === 'viewer' ? READ_ONLY_RPC_METHODS : EDITOR_RPC_METHODS;
  if (!allowedMethods.has(method)) return false;

  const targetWs = principal.share.workspaceId;
  const first = args[0];
  if (
    method === 'canvas.read' ||
    method === 'canvas.readNode' ||
    method === 'canvas.listNodes' ||
    method === 'workspaces.getTrashed' ||
    method === 'conversations.read' ||
    method === 'conversations.list' ||
    method === 'conversationScopes.read'
  ) {
    return first === targetWs;
  }
  if (method === 'canvas.commit') {
    return Boolean(first && typeof first === 'object' && (first as { workspaceId?: string }).workspaceId === targetWs);
  }
  if (method === 'conversations.commit' || method === 'conversationScopes.commit') {
    return Boolean(first && typeof first === 'object' && (first as { scopeId?: string }).scopeId === targetWs);
  }
  if (method === 'fileWrites.list') {
    if (first === undefined || first === null) return true;
    if (typeof first !== 'object') return false;
    const workspaceId = (first as { workspaceId?: unknown }).workspaceId;
    return workspaceId === undefined || workspaceId === targetWs;
  }
  if (method === 'fileWrites.get' || method === 'fileWrites.settle') {
    return typeof first === 'string' && first.length > 0;
  }
  if (method === 'changes.read') {
    if (first === undefined || first === null) return true;
    if (typeof first !== 'object') return false;
    const scopeId = (first as { scopeId?: unknown }).scopeId;
    return scopeId === undefined || scopeId === targetWs;
  }
  return true;
}
