export interface CodexSessionIndexEntry {
  id: string;
  threadName?: string;
  updatedAt: string;
}

export interface CodexThreadMatch {
  id: string;
  cwd?: string;
  title?: string;
  updatedAtMs?: number;
}
