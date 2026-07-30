/**
 * Live progress for in-flight scheduled runs.
 *
 * A scheduled run is started by MAIN, so it gets none of the per-invoke
 * `canvas-agent:*:<sessionId>` stream channels an interactive turn gets —
 * those ids are minted inside the renderer's `canvas-agent:chat` invoke
 * (`agent/ipc.ts`) and subscribed to inside `useChatStream.sendMessage`. The
 * engine still emits every text/tool chunk for a background run; main used to
 * collect them for session persistence and drop them on the floor, which is
 * why the task's conversation could only show a static "working on this
 * task…" placeholder until the whole run finished.
 *
 * This module is the fan-out for those chunks, deliberately COARSE: one push
 * per tool call, per tool result, per phase change. Text deltas move the phase
 * to `writing` exactly once and are otherwise ignored — forwarding the delta
 * firehose would turn a token stream into an IPC storm for no gain here (live
 * token streaming is a separate, larger change to the chat stream itself).
 *
 * Deliberately in-memory and ephemeral:
 * - NOT persisted into `scheduled-tasks.json`. `ScheduledTaskService.mutate()`
 *   is a full read-modify-write + rename + all-window broadcast, so a write
 *   per tool step would be an I/O storm for data that is worthless once the
 *   run ends.
 * - The step trail is bounded (`STEP_TAIL_LIMIT`), so a long run cannot grow
 *   this map without limit; `toolCalls` keeps the true total.
 *
 * `snapshot()` exists for LATE JOINERS: the whole point of a background task
 * is that nobody is watching when it starts, so a panel opened mid-run must be
 * able to catch up instead of waiting for the next event (which may be minutes
 * away, or never for a single-step run).
 *
 * Push channel: `scheduled:run-progress` (main → every window). Pushes are
 * invisible to describe-canvas' invoke/handle parity — this comment is their
 * registry, same convention as `agent/memory-report-ipc.ts`.
 */

import { BrowserWindow } from 'electron';
import type { ScheduledRunProgress, ScheduledRunToolStep } from '../../shared/scheduled';

/** Keep the recent trail only — the UI shows the current step, not a log. */
const STEP_TAIL_LIMIT = 12;

interface RunState {
  progress: ScheduledRunProgress;
  /** Open tool calls by `toolCallId`, so a result lands on its own step. */
  openSteps: Map<string, ScheduledRunToolStep>;
}

const runs = new Map<string, RunState>();

const clone = (progress: ScheduledRunProgress): ScheduledRunProgress => ({
  ...progress,
  steps: progress.steps.map((step) => ({ ...step })),
});

function broadcast(progress: ScheduledRunProgress): void {
  const payload = clone(progress);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('scheduled:run-progress', payload);
  }
}

function publish(state: RunState, now: number): void {
  state.progress.updatedAt = now;
  broadcast(state.progress);
}

export function beginRun(taskId: string, now = Date.now()): void {
  runs.set(taskId, {
    progress: {
      taskId,
      startedAt: now,
      updatedAt: now,
      phase: 'starting',
      steps: [],
      toolCalls: 0,
    },
    openSteps: new Map(),
  });
  broadcast(runs.get(taskId)!.progress);
}

export function noteToolCall(taskId: string, name: string, toolCallId?: string, now = Date.now()): void {
  const state = runs.get(taskId);
  if (!state) return;
  state.progress.toolCalls += 1;
  const step: ScheduledRunToolStep = {
    index: state.progress.toolCalls,
    name: name || 'tool',
    status: 'running',
    startedAt: now,
  };
  state.progress.steps.push(step);
  if (state.progress.steps.length > STEP_TAIL_LIMIT) state.progress.steps.shift();
  if (toolCallId) state.openSteps.set(toolCallId, step);
  state.progress.phase = 'tool';
  publish(state, now);
}

export function noteToolResult(taskId: string, name: string, toolCallId?: string, now = Date.now()): void {
  const state = runs.get(taskId);
  if (!state) return;
  // Match by id first; fall back to the newest running step of the same name.
  // The same tolerance modelMessagesToToolCalls needs: not every provider
  // dialect carries a toolCallId on both halves of the exchange.
  const step = (toolCallId ? state.openSteps.get(toolCallId) : undefined)
    ?? [...state.progress.steps].reverse().find((candidate) =>
      candidate.status === 'running' && candidate.name === name);
  if (step) {
    step.status = 'done';
    step.endedAt = now;
  }
  if (toolCallId) state.openSteps.delete(toolCallId);
  // Back to reasoning: the model has the result and has not started answering.
  if (state.progress.phase === 'tool') state.progress.phase = 'thinking';
  publish(state, now);
}

/**
 * First text delta of the run. Called per delta, so it must stay a cheap no-op
 * after the first one — this is the guard that keeps the token stream from
 * becoming an IPC stream.
 */
export function noteText(taskId: string, now = Date.now()): void {
  const state = runs.get(taskId);
  if (!state || state.progress.phase === 'writing') return;
  state.progress.phase = 'writing';
  publish(state, now);
}

/**
 * Mark the run as user-stopped. Returns false when the task has no run in
 * flight, so callers can report "nothing to stop" instead of silently
 * aborting an unrelated turn.
 */
export function requestCancel(taskId: string, now = Date.now()): boolean {
  const state = runs.get(taskId);
  if (!state) return false;
  state.progress.cancelRequested = true;
  publish(state, now);
  return true;
}

export function wasCancelRequested(taskId: string): boolean {
  return runs.get(taskId)?.progress.cancelRequested === true;
}

/** Final event for the run, then the state is gone. */
export function endRun(taskId: string, now = Date.now()): void {
  const state = runs.get(taskId);
  if (!state) return;
  runs.delete(taskId);
  state.progress.phase = 'done';
  state.progress.updatedAt = now;
  broadcast(state.progress);
}

export function snapshot(taskId: string): ScheduledRunProgress | undefined {
  const state = runs.get(taskId);
  return state ? clone(state.progress) : undefined;
}
