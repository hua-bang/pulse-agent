import type { InkCliEvent, InkCliSnapshot, InkLiveTool } from './ink-app.js';
import { InkUiBridgeSurface } from './bridge-surface.js';
import { EventLog } from './event-log.js';
import { LiveRun } from './live-run.js';

export interface InkUiSnapshot extends Omit<InkCliSnapshot, 'events' | 'liveText' | 'liveTools'> {}

interface InkUiBridgeOptions {
  onChange: (snapshot: InkCliSnapshot) => void;
  /** Minimum ms between snapshot emissions caused by streaming text. 0 = emit synchronously (tests). */
  textThrottleMs?: number;
}

const DEFAULT_SNAPSHOT: InkUiSnapshot = {
  sessionId: null,
  taskListId: null,
  mode: null,
  messages: 0,
  estimatedTokens: 0,
  usageInputTokens: 0,
  usageOutputTokens: 0,
  contextWindowTokens: 0,
  queuedInputs: 0,
  isProcessing: false,
  status: 'Ready',
  phase: 'Idle',
  activeTool: null,
  toolCalls: 0,
  completedTools: 0,
  lastStep: null,
  picker: null,
  skills: [],
  fileIndex: [],
};

/**
 * Single frequency source for the two independent throttle layers between a
 * streamed model delta and a terminal write:
 *
 * - This bridge throttles how often a new `InkCliSnapshot` is handed to
 *   React (`emitThrottled()`) — it limits REACT STATE UPDATE frequency.
 * - Ink's own `maxFps` (passed at `render()` in ink-launcher.tsx) throttles
 *   how often it actually WRITES to the terminal once state has changed.
 *
 * Both layers exist for a reason (React re-render cost vs. terminal I/O
 * cost) and neither can replace the other, but they used to run off two
 * unrelated constants (33ms here, ink's default maxFps:30 = 34ms) — two
 * differently-phased throttles worst-cases to roughly their SUM before a
 * delta reaches the screen. One exported constant keeps them the same rate.
 */
export const STREAM_FPS = 30;
const DEFAULT_TEXT_THROTTLE_MS = Math.ceil(1000 / STREAM_FPS);

/**
 * Bridges runtime callbacks to the Ink UI.
 *
 * Rendering model (Claude Code-style):
 * - `events` is an append-only transcript of finalized blocks (EventLog). The
 *   app renders it inside Ink's `<Static>`, so each event is printed once into
 *   the terminal's native scrollback and never re-rendered or truncated away.
 * - `liveText` / `liveTools` describe the in-flight region (LiveRun) that
 *   re-renders in place.
 * - The thin message surface (info/warn/section/…) lives on InkUiBridgeSurface.
 */
export class InkUiBridge extends InkUiBridgeSurface {
  private snapshot: InkUiSnapshot = { ...DEFAULT_SNAPSHOT };
  private readonly onChange: (snapshot: InkCliSnapshot) => void;
  private readonly textThrottleMs: number;
  private pendingEmit: NodeJS.Timeout | null = null;
  private lastEmitAt = 0;
  private readonly eventLog = new EventLog(() => this.emit());
  private readonly liveRun = new LiveRun({
    snapshot: () => this.snapshot,
    updateSnapshot: partial => this.updateSnapshot(partial),
    addEvent: (kind, title, text, emit, metadata) => { this.eventLog.add(kind, title, text, emit, metadata); },
    addToolTrace: (title, text, metadata) => this.eventLog.addToolTrace(title, text, metadata),
    flushPendingTrace: () => this.eventLog.flushPendingTrace(),
    emitThrottled: () => this.emitThrottled(),
  });

  constructor(options: InkUiBridgeOptions) {
    super();
    this.onChange = options.onChange;
    this.textThrottleMs = options.textThrottleMs ?? DEFAULT_TEXT_THROTTLE_MS;
  }

  /** Read-only views of the transcript and live region (also used by tests). */
  get events(): InkCliEvent[] {
    return this.eventLog.events;
  }

  get liveText(): string {
    return this.liveRun.liveText;
  }

  get liveTools(): InkLiveTool[] {
    return this.liveRun.liveTools;
  }

  getSnapshot(): InkCliSnapshot {
    return {
      ...this.snapshot,
      events: this.events,
      liveText: this.liveText,
      liveTools: this.liveTools,
    };
  }

  emit(): void {
    if (this.pendingEmit) {
      clearTimeout(this.pendingEmit);
      this.pendingEmit = null;
    }
    this.lastEmitAt = Date.now();
    this.onChange(this.getSnapshot());
  }

  private emitThrottled(): void {
    if (this.textThrottleMs <= 0) {
      this.emit();
      return;
    }

    const elapsed = Date.now() - this.lastEmitAt;
    if (elapsed >= this.textThrottleMs) {
      this.emit();
      return;
    }

    if (this.pendingEmit) {
      return;
    }
    this.pendingEmit = setTimeout(() => {
      this.pendingEmit = null;
      this.emit();
    }, this.textThrottleMs - elapsed);
  }

  updateSnapshot(partial: Partial<InkUiSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
    };
    this.emit();
  }

  abort(message: string): void {
    this.liveRun.abort(message);
  }

  startProcessing(label = 'Processing'): void {
    this.liveRun.startProcessing(label);
  }

  stopProcessing(): void {
    this.liveRun.stopProcessing();
  }

  text(delta: string): void {
    this.liveRun.text(delta);
  }

  toolInputStart(id: string, name: string): void {
    this.liveRun.toolInputStart(id, name);
  }

  toolInputDelta(id: string, delta: string): void {
    this.liveRun.toolInputDelta(id, delta);
  }

  toolInputEnd(id: string): void {
    this.liveRun.toolInputEnd(id);
  }

  toolCall(name: string, input?: unknown, callId?: string): void {
    this.liveRun.toolCall(name, input, callId);
  }

  toolResult(name: string, output?: unknown, callId?: string): void {
    this.liveRun.toolResult(name, output, callId);
  }

  stepFinished(reason: string): void {
    this.updateSnapshot({
      phase: 'Step finished',
      activeTool: null,
      lastStep: reason,
    });
  }

  /** Toggle between one-line summaries (default) and 3-line content previews for FUTURE tool traces. */
  setToolDetail(on: boolean): void {
    this.liveRun.toolDetail = on;
    this.log(on
      ? 'Detail: on · tool traces now include a content preview (Ctrl+O to turn off)'
      : 'Detail: off · tool traces show one-line summaries');
  }

  getToolDetail(): boolean {
    return this.liveRun.toolDetail;
  }

  /**
   * Toggle narration folding for FUTURE narration segments (finalizeLiveText
   * kind 'interim'). Same shape as setToolDetail()/Ctrl+O: a flag, a log line,
   * no effect on anything already printed — `events` is append-only, so this
   * can only ever change what happens next. The segment that ends a run is
   * never folded, collapsed or not.
   */
  setNarrationCollapse(on: boolean): void {
    this.liveRun.narrationCollapsed = on;
    this.log(on
      ? 'Narration: collapsed · future narration segments show a one-line summary (Ctrl+T to turn off)'
      : 'Narration: expanded · future narration segments show in full');
  }

  getNarrationCollapse(): boolean {
    return this.liveRun.narrationCollapsed;
  }

  protected addEvent(
    kind: InkCliEvent['kind'],
    title: string | undefined,
    text: string,
    emit = true,
    metadata: Pick<InkCliEvent, 'status' | 'summary'> = {},
  ): string {
    return this.eventLog.add(kind, title, text, emit, metadata);
  }

  protected flushPendingTrace(): void {
    this.eventLog.flushPendingTrace();
  }

  protected finalizeLiveText(kind: 'interim' | 'final' = 'final'): void {
    this.liveRun.finalizeLiveText(kind);
  }

  protected finalizeLiveTools(status: 'info' | 'error', note = ''): void {
    this.liveRun.finalizeLiveTools(status, note);
  }
}
