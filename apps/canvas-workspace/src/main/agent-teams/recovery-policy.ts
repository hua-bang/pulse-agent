import type { TeamTaskRecord } from 'pulse-coder-agent-teams/runtime';

export const LEAD_SESSION_DOWN_GATE_KIND = 'lead-session-down';
export const QUEUED_LAUNCH_REVIEW_REASON = 'Agent session was never relaunched to receive the dispatched task.';
export const DEFAULT_QUEUED_LAUNCH_GRACE_MS = 2 * 60_000;

const SESSION_EXIT_REVIEW_REASON_RE =
  /^Agent session (?:exited(?: with code -?\d+)? before reporting task completion|was never relaunched to receive the dispatched task)\.$/;

export function isRecoverableSessionExitReview(task: TeamTaskRecord, agentId: string): boolean {
  return task.status === 'needs_review'
    && task.ownerAgentId === agentId
    && typeof task.blockedReason === 'string'
    && SESSION_EXIT_REVIEW_REASON_RE.test(task.blockedReason);
}

export type QueuedLaunchObservation =
  | { state: 'started'; since: number }
  | { state: 'waiting'; since: number }
  | { state: 'expired' };

export function observeQueuedLaunch(
  since: number | undefined,
  now: number,
  graceMs: number,
): QueuedLaunchObservation {
  if (since === undefined) return { state: 'started', since: now };
  if (now - since < graceMs) return { state: 'waiting', since };
  return { state: 'expired' };
}
