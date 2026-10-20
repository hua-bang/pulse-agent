/**
 * Reuse a conversation's last context compaction on later turns.
 *
 * The session store keeps the full visible transcript, and every turn rebuilds
 * the model history from it. Without a checkpoint, a compaction only lived for
 * its own turn: once the transcript passed the trigger, every new message paid
 * for another summarizer call. A checkpoint records the summary messages and
 * how many stored messages they replace. The next turn sends the summary plus
 * the stored messages after it, and the engine compacts again only when that
 * history grows past the trigger.
 *
 * Checkpoints live in memory. After a restart the first long turn compacts
 * once and records a new one. A checkpoint is dropped when the stored
 * messages it covers change (edit, regenerate, truncation).
 */
import type { ModelMessage } from 'ai';
import type { CanvasAgentMessage } from '../types';

interface CompactionCheckpoint {
  /** Model messages that stand in for stored messages [0, coveredCount). */
  prefix: ModelMessage[];
  coveredCount: number;
  /** Identity of the covered stored messages, to detect history rewrites. */
  signature: string;
}

const MAX_CHECKPOINTS = 64;
const checkpoints = new Map<string, CompactionCheckpoint>();

const coveredSignature = (messages: readonly CanvasAgentMessage[], count: number): string => (
  messages.slice(0, count)
    // Content, not timestamps: the conversation runtime saves its own copy of
    // the user message with a later timestamp than the run's mirror.
    .map(message => `${message.role}:${message.content.length}:${message.content.slice(0, 64)}`)
    .join('|')
);

/**
 * Build the turn's model history. Returns the history, a map from each model
 * message built from a stored message to that stored message's index, and how
 * many stored messages the reused checkpoint covers.
 */
export function buildCheckpointedHistory(
  sessionId: string,
  stored: readonly CanvasAgentMessage[],
  toModel: (message: CanvasAgentMessage) => ModelMessage,
): { messages: ModelMessage[]; storeIndex: Map<ModelMessage, number>; coveredStart: number } {
  const checkpoint = checkpoints.get(sessionId);
  const valid = checkpoint
    && checkpoint.coveredCount <= stored.length
    && checkpoint.signature === coveredSignature(stored, checkpoint.coveredCount);
  if (checkpoint && !valid) checkpoints.delete(sessionId);
  const start = valid ? checkpoint.coveredCount : 0;
  const storeIndex = new Map<ModelMessage, number>();
  const tail = stored.slice(start).map((message, offset) => {
    const model = toModel(message);
    storeIndex.set(model, start + offset);
    return model;
  });
  return { messages: [...(valid ? checkpoint.prefix : []), ...tail], storeIndex, coveredStart: start };
}

/**
 * Record a compaction of the turn's history. `compacted` is the engine's new
 * list: new summary messages first, then messages kept from the old history.
 *
 * The checkpoint covers stored messages up to the first one the compaction
 * kept. When it kept none, it covers up to the last one it summarized. Stored
 * messages with no model counterpart in this turn (a reply saved by an earlier
 * relay segment) are never covered, so the next turn may repeat a little
 * context but never loses any.
 */
export function recordCompactionCheckpoint(
  sessionId: string,
  stored: readonly CanvasAgentMessage[],
  previous: readonly ModelMessage[],
  compacted: readonly ModelMessage[],
  storeIndex: ReadonlyMap<ModelMessage, number>,
  coveredStart: number,
): void {
  const old = new Set(previous);
  const firstKept = compacted.findIndex(message => old.has(message));
  const prefix = firstKept === -1 ? [...compacted] : compacted.slice(0, firstKept);
  if (prefix.length === 0) return;
  const kept = new Set(compacted);
  let firstKeptIndex = Number.POSITIVE_INFINITY;
  let lastSummarizedIndex = coveredStart - 1;
  for (const message of previous) {
    const index = storeIndex.get(message);
    if (index === undefined) continue;
    if (kept.has(message)) firstKeptIndex = Math.min(firstKeptIndex, index);
    else lastSummarizedIndex = Math.max(lastSummarizedIndex, index);
  }
  const coveredCount = Number.isFinite(firstKeptIndex) ? firstKeptIndex : lastSummarizedIndex + 1;
  checkpoints.delete(sessionId);
  checkpoints.set(sessionId, {
    prefix,
    coveredCount,
    signature: coveredSignature(stored, coveredCount),
  });
  while (checkpoints.size > MAX_CHECKPOINTS) {
    const oldest = checkpoints.keys().next().value;
    if (oldest === undefined) break;
    checkpoints.delete(oldest);
  }
}

export function resetCompactionCheckpointsForTests(): void {
  checkpoints.clear();
}
