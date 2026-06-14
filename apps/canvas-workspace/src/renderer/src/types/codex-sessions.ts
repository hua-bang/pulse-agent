import type {
  CodexSessionIndexEntry,
  CodexThreadMatch,
} from '../../../shared/codex-sessions';

export type * from '../../../shared/codex-sessions';

export interface CodexSessionsApi {
  list: (
    payload?: { updatedAfter?: string },
  ) => Promise<{ ok: boolean; sessions?: CodexSessionIndexEntry[]; error?: string }>;
  findByMarker: (
    payload: { marker: string; updatedAfterMs?: number; cwd?: string },
  ) => Promise<{
    ok: boolean;
    session?: CodexThreadMatch;
    ambiguous?: boolean;
    error?: string;
  }>;
}
