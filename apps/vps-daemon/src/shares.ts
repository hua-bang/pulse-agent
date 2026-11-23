import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

export type ShareRole = 'viewer' | 'editor' | 'collaborator';

export interface ShareTokenRecord {
  id: string;
  token: string;
  workspaceId: string;
  role: ShareRole;
  label?: string;
  createdAt: number;
  expiresAt?: number;
}

export interface ShareTokenSummary {
  id: string;
  workspaceId: string;
  role: ShareRole;
  label?: string;
  createdAt: number;
  expiresAt?: number;
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
    tokenPreview: preview,
  };
}

export class ShareTokenStore {
  private readonly filePath: string;
  private records: ShareTokenRecord[] = [];

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
            typeof (item as ShareTokenRecord).workspaceId === 'string' &&
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
    const now = Date.now();
    const record: ShareTokenRecord = {
      id: `sh_${randomBytes(6).toString('hex')}`,
      token: `pst_${randomBytes(24).toString('hex')}`,
      workspaceId: input.workspaceId.trim(),
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

export function isRemoteFileUriAllowed(principal: AuthPrincipal, uri: string): boolean {
  if (principal.kind === 'admin') return true;
  const raw = uri.replace(/^pulse-remote:\/\/+/, '');
  const prefix = `${principal.share.workspaceId}/`;
  return raw.startsWith(prefix);
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
  if (method === 'changes.read') {
    const scopeId = first && typeof first === 'object' ? (first as { scopeId?: string }).scopeId : undefined;
    return !scopeId || scopeId === targetWs;
  }
  return true;
}
