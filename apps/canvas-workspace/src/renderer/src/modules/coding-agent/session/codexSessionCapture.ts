import type { CodexSessionsApi } from '../../../types/codex-sessions';

const CAPTURE_POLL_MS = 1_000;
const CAPTURE_MAX_ATTEMPTS = 30;
const CAPTURE_CLOCK_SKEW_MS = 2_000;

interface CodexSessionCaptureOptions {
  api: CodexSessionsApi;
  baselineIds: Set<string> | null;
  launchStartedAt: number;
  marker?: string;
  cwd?: string;
  onCaptured: (sessionId: string) => void;
}

export const readCodexSessionBaseline = async (
  api: CodexSessionsApi | undefined,
): Promise<Set<string> | null> => {
  if (!api) return null;
  const result = await api.list().catch(() => null);
  if (!result?.ok || !result.sessions) return null;
  return new Set(result.sessions.map((entry) => entry.id));
};

/**
 * Binds a newly launched Codex CLI to the one local thread it created.
 * Marker lookup is authoritative; index diffing is a conservative fallback
 * and refuses to guess when multiple new sessions appear.
 */
export const startCodexSessionCapture = ({
  api,
  baselineIds,
  launchStartedAt,
  marker,
  cwd,
  onCaptured,
}: CodexSessionCaptureOptions): (() => void) => {
  let cancelled = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const updatedAfterMs = launchStartedAt - CAPTURE_CLOCK_SKEW_MS;
  const updatedAfter = new Date(updatedAfterMs).toISOString();

  const finish = (sessionId?: string) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!cancelled && sessionId) onCaptured(sessionId);
  };

  const poll = async () => {
    if (cancelled) return;
    attempts += 1;

    if (marker) {
      const markerResult = await api.findByMarker({ marker, updatedAfterMs, cwd }).catch(() => null);
      if (cancelled) return;
      if (markerResult?.ok && markerResult.session?.id) {
        finish(markerResult.session.id);
        return;
      }
    }

    if (baselineIds) {
      const result = await api.list({ updatedAfter }).catch(() => null);
      if (cancelled) return;
      if (result?.ok && result.sessions) {
        const newSessions = result.sessions.filter((entry) => !baselineIds.has(entry.id));
        if (newSessions.length === 1) {
          finish(newSessions[0].id);
          return;
        }
        if (newSessions.length > 1) {
          finish();
          return;
        }
      }
    }

    if (attempts < CAPTURE_MAX_ATTEMPTS) timer = setTimeout(poll, CAPTURE_POLL_MS);
    else finish();
  };

  timer = setTimeout(poll, CAPTURE_POLL_MS);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
};
