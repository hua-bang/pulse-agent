import type { CommitReceipt, Page, PageRequest } from './contracts.js';

/** Resource versions and URIs are interpreted by the file adapter, not the database. */
export interface FileWriteInput {
  id: string;
  nodeId: string;
  uri: string;
  baseVersion: string | null;
  targetVersion: string;
  /** Recovery snapshots, never independently editable copies of the source file. */
  baseContent: string | null;
  content: string;
}

export type FileWriteStatus = 'pending' | 'applied' | 'conflict' | 'error';

export interface FileWriteRecord extends FileWriteInput {
  workspaceId: string;
  status: FileWriteStatus;
  error?: string;
}

export interface FileWriteListRequest extends PageRequest {
  workspaceId?: string;
  statuses?: readonly FileWriteStatus[];
}

export interface FileWriteSettlement {
  status: Exclude<FileWriteStatus, 'pending'>;
  error?: string;
}

export interface FileWriteResolution {
  record: FileWriteRecord;
  /** Present when settling the intent also changed the matching node's index state. */
  canvasCommit?: CommitReceipt;
}

export interface FileWriteRepository {
  get(id: string): Promise<FileWriteRecord | null>;
  list(request?: FileWriteListRequest): Promise<Page<FileWriteRecord>>;
  settle(id: string, outcome: FileWriteSettlement): Promise<FileWriteResolution>;
}
