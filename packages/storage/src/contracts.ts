import type { ConversationScopeRepository } from './conversation-scopes.js';
import type { FileWriteInput, FileWriteRepository } from './file-contracts.js';
import type { WorkspaceRepository } from './workspace-contracts.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }

/** Unknown plugin fields survive storage without coupling the core to a host union. */
export interface EntityRecord extends JsonObject { id: string }

export interface PageRequest {
  /** Opaque adapter cursor. Consumers must not parse or manufacture it. */
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface RecordChanges {
  put?: readonly EntityRecord[];
  remove?: readonly string[];
}

export interface CanvasSnapshot {
  generation: string;
  workspaceId: string;
  revision: number;
  metadata: JsonObject;
  /** Knowledge records, including records that are not placed on the canvas. */
  nodes: EntityRecord[];
  /** A placement is distinct from its backing knowledge record. */
  placements: EntityRecord[];
  edges: EntityRecord[];
}

export interface CanvasCommit {
  fileWrites?: readonly FileWriteInput[];
  expectedGeneration?: string;
  workspaceId: string;
  /** null creates a workspace; an existing workspace always requires its revision. */
  expectedRevision: number | null;
  metadata?: JsonObject;
  nodes?: RecordChanges;
  placements?: RecordChanges;
  edges?: RecordChanges;
}

export interface CommitReceipt {
  generation: string;
  revision: number;
  /** Cursor into committed changes, not a wall-clock timestamp. */
  changeCursor: string;
}

export interface CanvasRepository {
  read(workspaceId: string): Promise<CanvasSnapshot | null>;
  list(request?: PageRequest): Promise<Page<{ workspaceId: string; revision: number; metadata: JsonObject }>>;
  readNode(workspaceId: string, nodeId: string): Promise<EntityRecord | null>;
  listNodes(workspaceId: string, request?: PageRequest): Promise<Page<EntityRecord>>;
  commit(input: CanvasCommit): Promise<CommitReceipt>;
  remove(workspaceId: string, expectedRevision: number): Promise<CommitReceipt>;
}

export interface ConversationSnapshot {
  generation: string;
  scopeId: string;
  sessionId: string;
  revision: number;
  metadata: JsonObject;
  messages: EntityRecord[];
}

export interface ConversationCommit {
  expectedGeneration?: string;
  scopeId: string;
  sessionId: string;
  expectedRevision: number | null;
  metadata?: JsonObject;
  /** Omit to keep history; use for edit/regenerate, preserving message identities. */
  replaceMessages?: readonly EntityRecord[];
  appendMessages?: readonly EntityRecord[];
}

export interface ConversationRepository {
  read(scopeId: string, sessionId: string): Promise<ConversationSnapshot | null>;
  list(scopeId: string, request?: PageRequest): Promise<Page<Omit<ConversationSnapshot, 'messages'>>>;
  commit(input: ConversationCommit): Promise<CommitReceipt>;
  remove(scopeId: string, sessionId: string, expectedRevision: number): Promise<CommitReceipt>;
}

export interface StorageChange {
  cursor: string;
  domain: 'canvas' | 'conversation' | 'conversation-scope';
  scopeId: string;
  resourceId: string;
  revision: number;
  kind: 'updated' | 'removed';
  changedIds: string[];
}

/** Every change becomes visible in the same transaction as its domain records. */
export interface ChangeRepository {
  read(request?: PageRequest): Promise<Page<StorageChange>>;
  latestCursor(): Promise<string>;
}

export interface StorageIntegrity {
  ok: boolean;
  issues: string[];
}

export interface PulseStorage {
  /** Opaque identity of this store, stable across opens but different after replacement. */
  generation: string;
  canvas: CanvasRepository;
  workspaces: WorkspaceRepository;
  conversations: ConversationRepository;
  conversationScopes: ConversationScopeRepository;
  fileWrites: FileWriteRepository;
  changes: ChangeRepository;
  /** Produce a consistent backup without exposing database connection types. */
  backup(destination: string): Promise<void>;
  checkIntegrity(): Promise<StorageIntegrity>;
  close(): Promise<void>;
}
