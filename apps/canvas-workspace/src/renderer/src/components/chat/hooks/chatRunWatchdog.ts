import type { AgentChatMessage } from '../../../types';

export interface ChatRunWatchdogOptions {
  pollMs?: number;
  getRunStatus: () => Promise<{ ok: boolean; active: boolean }>;
  recoverHistory: () => Promise<{ ok: boolean; messages?: AgentChatMessage[] }>;
  onRecovered: (messages: AgentChatMessage[]) => void;
  onRecoveryFailed: (error: string) => void;
}

const DEFAULT_POLL_MS = 3_000;

/**
 * Recovers a turn whose main process settled but whose completion event was
 * lost (renderer suspension/navigation around the final IPC send).
 */
export function startChatRunWatchdog({
  pollMs = DEFAULT_POLL_MS,
  getRunStatus,
  recoverHistory,
  onRecovered,
  onRecoveryFailed,
}: ChatRunWatchdogOptions): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (cancelled) return;
    timer = setTimeout(() => { void check(); }, pollMs);
  };

  const check = async () => {
    try {
      const status = await getRunStatus();
      if (cancelled) return;
      if (!status.ok || status.active) {
        schedule();
        return;
      }
      const history = await recoverHistory();
      if (cancelled) return;
      cancelled = true;
      if (history.ok && history.messages) {
        onRecovered(history.messages);
      } else {
        onRecoveryFailed('The completed reply could not be restored.');
      }
    } catch (error) {
      if (cancelled) return;
      // A transient status IPC failure is not evidence the run failed.
      schedule();
    }
  };

  schedule();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
