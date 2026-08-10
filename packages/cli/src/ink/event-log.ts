import type { InkCliEvent } from './ink-app.js';
import { truncateEventText } from './event-text.js';

/**
 * Append-only transcript store plus the one-beat tool-trace merge buffer.
 * Events render via Ink's <Static> — printed once, never rewritten — so the
 * `· ×N` merge of identical traces must happen before the first one prints.
 */
export class EventLog {
  private eventList: InkCliEvent[] = [];
  private eventCounter = 0;
  private pendingTrace: { title: string; status?: InkCliEvent['status']; summary?: string; count: number } | null = null;

  constructor(private readonly onEmit: () => void) {}

  get events(): InkCliEvent[] {
    return this.eventList;
  }
  /**
   * Emits a tool trace, but holds it back one beat instead of printing it
   * immediately: `events` is append-only and rendered via `<Static>`, so an
   * already-printed row can never be rewritten. Merging N consecutive
   * identical traces into one `label · ×N` line therefore has to happen
   * BEFORE the first of them prints — which means we cannot know yet whether
   * to print it until the NEXT event tells us it does not match.
   *
   * Cost: a trace reaches the screen one event later than it actually
   * happened. Every terminal path (error/abort/runSummary/stopProcessing/
   * clarification/user) explicitly flushes so nothing pending is ever lost.
   */
  addToolTrace(title: string, text: string, metadata: Pick<InkCliEvent, 'status' | 'summary'>): void {
    const mergeable = text === '';

    if (
      mergeable &&
      this.pendingTrace &&
      this.pendingTrace.title === title &&
      this.pendingTrace.status === metadata.status
    ) {
      this.pendingTrace.count += 1;
      return;
    }

    this.flushPendingTrace();

    if (mergeable) {
      this.pendingTrace = { title, status: metadata.status, summary: metadata.summary, count: 1 };
      return;
    }

    this.add('tool', title, text, true, metadata);
  }

  /** Prints whatever trace is being held back for a possible merge, if any. */
  flushPendingTrace(): void {
    if (!this.pendingTrace) {
      return;
    }
    const { title, status, summary, count } = this.pendingTrace;
    this.pendingTrace = null;
    this.add('tool', count > 1 ? `${title} ·×${count}` : title, '', true, { status, summary });
  }

  add(
    kind: InkCliEvent['kind'],
    title: string | undefined,
    text: string,
    emit = true,
    metadata: Pick<InkCliEvent, 'status' | 'summary'> = {},
  ): string {
    // Every OTHER event kind must land in chronological order relative to a
    // trace still held back by addToolTrace() — an engine log line or the
    // next narration segment must not print ahead of a tool trace that
    // actually finished before it.
    if (kind !== 'tool') {
      this.flushPendingTrace();
    }
    const id = `event-${++this.eventCounter}`;
    this.eventList = [
      ...this.eventList,
      {
        id,
        kind,
        title,
        text: truncateEventText(text),
        ...metadata,
      },
    ];

    if (emit) {
      this.onEmit();
    }

    return id;
  }
}
