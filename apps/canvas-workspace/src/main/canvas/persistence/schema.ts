import {
  WORKSPACE_NODE_SCHEMA_VERSION,
  type WorkspaceNodeLink,
  type WorkspaceNodePropertyValue,
  type WorkspaceNodeRecord,
} from '../nodes/store';

export const PER_NODE_SCHEMA_VERSION = WORKSPACE_NODE_SCHEMA_VERSION;
export const CANVAS_SCHEMA_VERSION_V2 = 2;

export interface CanvasNode {
  id?: string;
  type: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  ref?: unknown;
  data?: Record<string, unknown>;
  properties?: Record<string, WorkspaceNodePropertyValue>;
  links?: WorkspaceNodeLink[];
  updatedAt?: number;
}

export interface CanvasSaveData {
  schemaVersion?: 1 | 2;
  nodes?: CanvasNode[];
  edges?: unknown[];
  transform?: unknown;
  savedAt?: string;
}

export type PerNodeFile = WorkspaceNodeRecord;
export type SchemaVersion = 1 | 2;

export interface MigrationSentinel {
  startedAt: number;
  workspaceId: string;
  sourceUpdatedAt: number | null;
  expectedNodeIds: string[];
}

export interface MigrationProgress {
  phase: 'starting' | 'backup' | 'split-nodes' | 'commit' | 'done' | 'error';
  current?: number;
  total?: number;
  message?: string;
}

export interface ReadCanvasResult {
  data: CanvasSaveData | null;
  recoveredFromBackup: boolean;
  schemaVersion: SchemaVersion | null;
}

export function detectSchemaVersion(parsed: unknown): SchemaVersion {
  if (parsed && typeof parsed === 'object') {
    const version = (parsed as { schemaVersion?: unknown }).schemaVersion;
    if (version === 2) return 2;
  }
  return 1;
}

export type { WorkspaceNodeLink, WorkspaceNodePropertyValue, WorkspaceNodeRecord };
