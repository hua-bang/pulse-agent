import type { InkCliEvent, InkLiveTool } from './ink-app.js';
import type { InkUiSnapshot } from './ink-ui-bridge.js';
import { truncateEventText } from './event-text.js';
import { formatPendingInputTail, formatToolLabel, summarizeToolInput, compactText } from './tool-input-format.js';
import { detectToolError, formatToolResultPreview, summarizeToolResult } from './tool-output-format.js';

interface LiveRunHost {
  snapshot(): Readonly<InkUiSnapshot>;
  updateSnapshot(partial: Partial<InkUiSnapshot>): void;
  addEvent(kind: InkCliEvent['kind'], title: string | undefined, text: string, emit?: boolean, metadata?: Pick<InkCliEvent, 'status' | 'summary'>): void;
  addToolTrace(title: string, text: string, metadata: Pick<InkCliEvent, 'status' | 'summary'>): void;
  flushPendingTrace(): void;
  emitThrottled(): void;
}

/**
 * The in-flight run region: streaming assistant text, running tool lines,
 * the abort latch, and the finalize semantics that move live content into
 * the append-only transcript (narration vs final answer, cancelled tools).
 */
export class LiveRun {
  private liveTextBuffer = '';
  private liveToolList: InkLiveTool[] = [];
  private liveToolCounter = 0;
  /** Set by abort(), cleared by startProcessing(): drops late streaming events. */
  private cancelled = false;
  private readonly pendingInputBuffers = new Map<string, string>();
  /** Ctrl+O: one-line summaries (default) vs 3-line content previews for future traces. */
  toolDetail = false;
  /** Ctrl+T / /narration: fold future interim narration segments. */
  narrationCollapsed = false;

  constructor(private readonly host: LiveRunHost) {}

  get liveText(): string {
    return this.liveTextBuffer;
  }

  get liveTools(): InkLiveTool[] {
    return this.liveToolList;
  }

  abort(message: string): void {
    // Latch: the model keeps streaming for a while after the signal fires (the
    // engine returns its sentinel only once the current step unwinds), and
    // those late deltas used to walk straight past the dedupe guard below —
    // resurrecting `liveText` and `liveTools` so the next abort wrote a SECOND
    // Abort block, painting bright answer fragments under a Cancelled status,
    // and leaving tool lines spinning forever. Cleared by startProcessing().
    this.cancelled = true;

    if (this.host.snapshot().status === 'Cancelled' && this.liveToolList.length === 0 && !this.liveTextBuffer) {
      // Already cancelled and nothing left live: a second Esc must not write
      // another permanent Abort block to the transcript.
      return;
    }
    // Terminal path: a trace still held back for a possible merge must reach
    // the transcript now — it is a completed trace, not part of what is being
    // cancelled below.
    this.host.flushPendingTrace();
    this.finalizeLiveText();
    this.finalizeLiveTools('error', '(cancelled)');
    this.host.updateSnapshot({
      isProcessing: false,
      status: 'Cancelled',
      phase: 'Cancelled',
      activeTool: null,
      runStartedAt: null,
    });
    this.host.addEvent('error', 'Abort', message);
  }

  startProcessing(label = 'Processing'): void {
    this.cancelled = false;
    this.liveTextBuffer = '';
    this.liveToolList = [];
    this.pendingInputBuffers.clear();
    this.host.updateSnapshot({
      isProcessing: true,
      status: label,
      phase: label,
      activeTool: null,
      runStartedAt: Date.now(),
      toolCalls: 0,
      completedTools: 0,
      lastStep: null,
    });
  }

  stopProcessing(): void {
    // Terminal path: flush before anything else, or a trace still held back
    // for a possible merge is silently lost.
    this.host.flushPendingTrace();
    this.finalizeLiveText();
    this.finalizeLiveTools('info');
    this.host.updateSnapshot({
      isProcessing: false,
      status: 'Ready',
      phase: 'Idle',
      activeTool: null,
      runStartedAt: null,
    });
  }

  text(delta: string): void {
    if (this.cancelled) {
      return;
    }
    this.liveTextBuffer = truncateEventText(`${this.liveTextBuffer}${delta}`);
    this.host.emitThrottled();
  }

  /**
   * Streaming tool arguments (AI SDK tool-input-* chunks): a live line appears
   * as soon as the model starts emitting a call, its label growing with the
   * argument tail, and is replaced in place by the final label on tool-call.
   */
  toolInputStart(id: string, name: string): void {
    if (this.cancelled) {
      return;
    }
    this.finalizeLiveText('interim');
    this.pendingInputBuffers.set(id, '');
    this.liveToolList = [...this.liveToolList, { id, name, label: `${name} …` }];
    this.host.updateSnapshot({
      phase: 'Using tool',
      activeTool: name,
    });
  }

  toolInputDelta(id: string, delta: string): void {
    if (this.cancelled || !this.pendingInputBuffers.has(id)) {
      return;
    }
    const buffer = `${this.pendingInputBuffers.get(id)}${delta}`.slice(-400);
    this.pendingInputBuffers.set(id, buffer);
    if (!this.liveToolList.some(tool => tool.id === id)) {
      return;
    }
    const tail = formatPendingInputTail(buffer);
    this.liveToolList = this.liveToolList.map(tool => tool.id === id ? { ...tool, label: `${tool.name} · ${tail}` } : tool);
    this.host.emitThrottled();
  }

  toolInputEnd(id: string): void {
    this.pendingInputBuffers.delete(id);
  }

  toolCall(name: string, input?: unknown, callId?: string): void {
    if (this.cancelled) {
      return;
    }
    // Text finalized because a tool starts = in-run narration, not the answer.
    this.finalizeLiveText('interim');
    const label = formatToolLabel(name, summarizeToolInput(name, input));
    const pendingIndex = callId ? this.liveToolList.findIndex(tool => tool.id === callId) : -1;
    if (pendingIndex >= 0) {
      this.liveToolList = this.liveToolList.map((tool, index) => index === pendingIndex ? { ...tool, name, label } : tool);
    } else {
      this.liveToolList = [...this.liveToolList, {
        id: callId ?? `live-tool-${++this.liveToolCounter}`,
        name,
        label,
      }];
    }
    // The status TEXT stays stable while running — per-tool churn ("Running
    // tool: X" / "Completed tool: Y") goes stale the moment tools overlap.
    this.host.updateSnapshot({
      phase: 'Using tool',
      activeTool: name,
      toolCalls: this.host.snapshot().toolCalls + 1,
    });
  }

  toolResult(name: string, output?: unknown, callId?: string): void {
    if (this.cancelled) {
      return;
    }
    const entry = this.takeRunningTool(name, callId);
    const isError = detectToolError(output);
    const label = entry?.label ?? name;
    const summary = summarizeToolResult(name, output, isError);
    const preview = this.toolDetail ? formatToolResultPreview(output) : '';
    // title/summary stay SEPARATE fields (not concatenated): the renderer
    // truncates the label against the terminal width and always keeps the
    // summary intact on the same line, so a long label cannot orphan-wrap
    // "· N lines" onto its own row. See TranscriptEvent in ink-app.tsx.
    this.host.addToolTrace(label, preview, { status: isError ? 'error' : 'success', summary: summary || undefined });

    const stillRunning = this.liveToolList.length > 0;
    this.host.updateSnapshot({
      phase: stillRunning ? 'Using tool' : 'Tool completed',
      activeTool: stillRunning ? this.liveToolList[this.liveToolList.length - 1].name : null,
      completedTools: Math.min(this.host.snapshot().toolCalls, this.host.snapshot().completedTools + 1),
    });
  }

  /**
   * `interim` = narration between tool calls (rendered muted);
   * `final` = the answer segment that ends a run (bright + markdown).
   */
  finalizeLiveText(kind: 'interim' | 'final' = 'final'): void {
    if (!this.liveTextBuffer.trim()) {
      this.liveTextBuffer = '';
      return;
    }

    const text = this.liveTextBuffer;
    this.liveTextBuffer = '';
    // Narration folding only ever applies to 'interim' segments — the segment
    // that ends a run ('final') is the answer and is never folded.
    const displayText = kind === 'interim' && this.narrationCollapsed ? this.collapseNarration(text) : text;
    this.host.addEvent('assistant', undefined, displayText, true, kind === 'interim' ? { status: 'info' } : {});
  }

  /** First line (truncated) + "… +N lines" for a folded narration segment. */
  private collapseNarration(text: string): string {
    const lines = text.trim().split('\n');
    if (lines.length <= 1) {
      return compactText(lines[0] ?? text, 96);
    }
    const rest = lines.length - 1;
    return `${compactText(lines[0], 96)} … +${rest} line${rest === 1 ? '' : 's'}`;
  }

  finalizeLiveTools(status: 'info' | 'error', note = ''): void {
    if (this.liveToolList.length === 0) {
      return;
    }

    const pending = this.liveToolList;
    this.liveToolList = [];
    for (const entry of pending) {
      this.host.addEvent('tool', entry.label, note, true, { status });
    }
  }

  private takeRunningTool(name: string, callId?: string): InkLiveTool | null {
    const byId = callId ? this.liveToolList.findIndex(entry => entry.id === callId) : -1;
    const byName = this.liveToolList.findIndex(entry => entry.name === name);
    const resolvedIndex = byId >= 0 ? byId : byName >= 0 ? byName : this.liveToolList.length > 0 ? 0 : -1;
    if (resolvedIndex < 0) {
      return null;
    }

    const entry = this.liveToolList[resolvedIndex];
    this.liveToolList = this.liveToolList.filter((_, i) => i !== resolvedIndex);
    return entry;
  }
}
