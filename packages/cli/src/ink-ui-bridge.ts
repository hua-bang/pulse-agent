import type { ClarificationRequest } from 'pulse-coder-engine';

import type { TuiHelpItem, TuiRunSummary, TuiSessionSnapshot } from './tui-renderer.js';
import type { InkCliEvent, InkCliSnapshot, InkLiveTool, InkPickerState } from './ink-app.js';

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

const MAX_EVENT_TEXT_LENGTH = 20000;
const DEFAULT_TEXT_THROTTLE_MS = 33;

/**
 * Bridges runtime callbacks to the Ink UI.
 *
 * Rendering model (Claude Code-style):
 * - `events` is an append-only transcript of finalized blocks. The app renders
 *   it inside Ink's `<Static>`, so each event is printed once into the
 *   terminal's native scrollback and never re-rendered or truncated away.
 * - `liveText` / `liveTools` describe the in-flight region (streaming
 *   assistant text, currently running tools) that re-renders in place.
 */
export class InkUiBridge {
  private snapshot: InkUiSnapshot = { ...DEFAULT_SNAPSHOT };
  private events: InkCliEvent[] = [];
  private eventCounter = 0;
  private liveText = '';
  private liveTools: InkLiveTool[] = [];
  private liveToolCounter = 0;
  private readonly onChange: (snapshot: InkCliSnapshot) => void;
  private readonly textThrottleMs: number;
  private pendingEmit: NodeJS.Timeout | null = null;
  private lastEmitAt = 0;
  private toolDetail = false;
  /** Off by default: narration segments print in full. Ctrl+T / `/narration`. */
  private narrationCollapsed = false;
  /** Set by abort(), cleared by startProcessing(): drops late streaming events. */
  private cancelled = false;
  private readonly pendingInputBuffers = new Map<string, string>();
  /**
   * A tool trace held back one beat so N consecutive identical traces can
   * merge into one `· ×N` line — see addToolTrace() for why this has to
   * happen before the first of them ever prints.
   */
  private pendingTrace: { title: string; status?: InkCliEvent['status']; summary?: string; count: number } | null = null;

  constructor(options: InkUiBridgeOptions) {
    this.onChange = options.onChange;
    this.textThrottleMs = options.textThrottleMs ?? DEFAULT_TEXT_THROTTLE_MS;
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

  showWelcome(info: { cwd?: string } = {}): void {
    const lines = [
      info.cwd ? `cwd: ${info.cwd}` : null,
      'Type a message and press Enter. / for commands, Shift+Tab cycles mode.',
      'Esc stops the current run · Ctrl+C twice exits.',
    ].filter((line): line is string => Boolean(line));
    this.addEvent('system', 'Pulse Coder', lines.join('\n'));
  }

  showHelp(items: TuiHelpItem[], footer: string[] = []): void {
    const commandWidth = Math.max(...items.map(item => item.command.length));
    const lines = items.map(item => `${item.command.padEnd(commandWidth)}  ${item.description}`);
    this.addEvent('system', 'Commands', [...lines, ...footer].join('\n'));
  }

  showPluginStatus(count: number): void {
    this.success(`Built-in plugins loaded: ${count} plugins`);
  }

  showTuiStatus(): void {
    this.section('TUI Status', [
      'Current UI: Ink',
      'Discovery: type / for slash-command suggestions, Tab completes the first match, Shift+Tab cycles CLI mode',
      'Input: Enter send, Ctrl+J newline, ↑/↓ history (persisted), ←/→ move cursor, Ctrl+A/E jump, paste is inserted literally',
      'Editing: Ctrl+U delete before cursor, Ctrl+K delete after cursor, Ctrl+W delete previous word',
      'Control: Esc stops a run or clears the draft; Ctrl+C twice exits (first press clears the draft)',
      'Transcript: finished output stays in the terminal scrollback — scroll up to review it',
      `Tool trace detail: Ctrl+O toggles (currently ${this.toolDetail ? 'on' : 'off'})`,
      `Narration folding: Ctrl+T or /narration on|off toggles (currently ${this.narrationCollapsed ? 'on' : 'off'})`,
      'Fallback: PULSE_CODER_UI=readline pulse-coder',
      'Plain fallback: PULSE_CODER_PLAIN=1 PULSE_CODER_UI=readline pulse-coder',
    ]);
  }

  session(snapshot: TuiSessionSnapshot): void {
    this.updateSnapshot({
      sessionId: snapshot.sessionId,
      taskListId: snapshot.taskListId,
      messages: snapshot.messages,
      estimatedTokens: snapshot.estimatedTokens,
      mode: snapshot.mode,
    });
  }

  /** Modal list selection rendered in place of the composer (e.g. /resume). */
  showPicker(picker: InkPickerState): void {
    this.updateSnapshot({ picker, status: picker.title });
  }

  hidePicker(status = 'Ready'): void {
    this.updateSnapshot({ picker: null, status });
  }

  /** Clears per-conversation usage readouts (on /new, /clear, /resume). */
  resetUsage(): void {
    this.updateSnapshot({
      usageInputTokens: 0,
      usageOutputTokens: 0,
      usageCachedTokens: undefined,
      estimatedTokens: 0,
      toolCalls: 0,
      completedTools: 0,
    });
  }

  usage(usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }): void {
    this.updateSnapshot({
      ...(typeof usage.inputTokens === 'number' ? { usageInputTokens: usage.inputTokens } : {}),
      ...(typeof usage.outputTokens === 'number' ? { usageOutputTokens: usage.outputTokens } : {}),
      ...(typeof usage.cachedInputTokens === 'number' ? { usageCachedTokens: usage.cachedInputTokens } : {}),
    });
  }

  runSummary(summary: TuiRunSummary): void {
    // Terminal path: a trace still held back for a possible merge must reach
    // the transcript now, or it is silently lost.
    this.flushPendingTrace();
    this.finalizeLiveText();
    this.finalizeLiveTools('info');
    this.updateSnapshot({
      isProcessing: false,
      messages: summary.messages,
      estimatedTokens: summary.estimatedTokens,
      mode: summary.mode,
      status: `Done in ${this.formatDuration(summary.elapsedMs)} · tools ${summary.toolCalls}`,
      phase: 'Complete',
      activeTool: null,
      runStartedAt: null,
      toolCalls: summary.toolCalls,
      completedTools: summary.toolCalls,
    });
  }

  section(title: string, lines: string[]): void {
    this.addEvent('system', title, lines.join('\n'));
  }

  /** The complete answer for runs that produced no streaming deltas. */
  plain(message = ''): void {
    if (!message) {
      this.finalizeLiveText();
      return;
    }

    // 'assistant' (not 'system') so it renders bright with markdown, matching
    // the streamed path — this is the answer, not a notice.
    this.addEvent('assistant', undefined, message);
  }

  info(message: string): void {
    this.addEvent('system', undefined, message);
  }

  success(message: string): void {
    this.addEvent('system', 'Success', message);
  }

  warn(message: string): void {
    this.addEvent('system', 'Warning', message);
  }

  error(message: string): void {
    // Terminal path: flush before anything else, or a trace still held back
    // for a possible merge is silently lost.
    this.flushPendingTrace();
    // Mirrors abort(): a mid-run failure must close out the live region too,
    // or partially streamed text is lost and live tool lines spin forever.
    this.finalizeLiveText();
    this.finalizeLiveTools('error', '(failed)');
    this.addEvent('error', undefined, message);
  }

  /** Engine log layer: rendered as a compact dim line in the transcript. */
  log(message: string): void {
    this.addEvent('log', undefined, message);
  }

  queued(message: string): void {
    this.addEvent('system', 'Queued', message);
  }

  abort(message: string): void {
    // Latch: the model keeps streaming for a while after the signal fires (the
    // engine returns its sentinel only once the current step unwinds), and
    // those late deltas used to walk straight past the dedupe guard below —
    // resurrecting `liveText` and `liveTools` so the next abort wrote a SECOND
    // Abort block, painting bright answer fragments under a Cancelled status,
    // and leaving tool lines spinning forever. Cleared by startProcessing().
    this.cancelled = true;

    if (this.snapshot.status === 'Cancelled' && this.liveTools.length === 0 && !this.liveText) {
      // Already cancelled and nothing left live: a second Esc must not write
      // another permanent Abort block to the transcript.
      return;
    }
    // Terminal path: a trace still held back for a possible merge must reach
    // the transcript now — it is a completed trace, not part of what is being
    // cancelled below.
    this.flushPendingTrace();
    this.finalizeLiveText();
    this.finalizeLiveTools('error', '(cancelled)');
    this.updateSnapshot({
      isProcessing: false,
      status: 'Cancelled',
      phase: 'Cancelled',
      activeTool: null,
      runStartedAt: null,
    });
    this.addEvent('error', 'Abort', message);
  }

  startProcessing(label = 'Processing'): void {
    this.cancelled = false;
    this.liveText = '';
    this.liveTools = [];
    this.pendingInputBuffers.clear();
    this.updateSnapshot({
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
    this.flushPendingTrace();
    this.finalizeLiveText();
    this.finalizeLiveTools('info');
    this.updateSnapshot({
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
    this.liveText = this.truncateEventText(`${this.liveText}${delta}`);
    this.emitThrottled();
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
    this.liveTools = [...this.liveTools, { id, name, label: `${name} …` }];
    this.updateSnapshot({
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
    if (!this.liveTools.some(tool => tool.id === id)) {
      return;
    }
    const tail = this.formatPendingInputTail(buffer);
    this.liveTools = this.liveTools.map(tool => tool.id === id ? { ...tool, label: `${tool.name} · ${tail}` } : tool);
    this.emitThrottled();
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
    const label = this.formatToolLabel(name, this.summarizeToolInput(name, input));
    const pendingIndex = callId ? this.liveTools.findIndex(tool => tool.id === callId) : -1;
    if (pendingIndex >= 0) {
      this.liveTools = this.liveTools.map((tool, index) => index === pendingIndex ? { ...tool, name, label } : tool);
    } else {
      this.liveTools = [...this.liveTools, {
        id: callId ?? `live-tool-${++this.liveToolCounter}`,
        name,
        label,
      }];
    }
    // The status TEXT stays stable while running — per-tool churn ("Running
    // tool: X" / "Completed tool: Y") goes stale the moment tools overlap.
    this.updateSnapshot({
      phase: 'Using tool',
      activeTool: name,
      toolCalls: this.snapshot.toolCalls + 1,
    });
  }

  /** Toggle between one-line summaries (default) and 3-line content previews for FUTURE tool traces. */
  setToolDetail(on: boolean): void {
    this.toolDetail = on;
    this.log(on
      ? 'Detail: on · tool traces now include a content preview (Ctrl+O to turn off)'
      : 'Detail: off · tool traces show one-line summaries');
  }

  getToolDetail(): boolean {
    return this.toolDetail;
  }

  /**
   * Toggle narration folding for FUTURE narration segments (finalizeLiveText
   * kind 'interim'). Same shape as setToolDetail()/Ctrl+O: a flag on the
   * bridge, a log line, no effect on anything already printed — `events` is
   * append-only, so this can only ever change what happens next. The
   * segment that ends a run is never folded, collapsed or not.
   */
  setNarrationCollapse(on: boolean): void {
    this.narrationCollapsed = on;
    this.log(on
      ? 'Narration: collapsed · future narration segments show a one-line summary (Ctrl+T to turn off)'
      : 'Narration: expanded · future narration segments show in full');
  }

  getNarrationCollapse(): boolean {
    return this.narrationCollapsed;
  }

  toolResult(name: string, output?: unknown, callId?: string): void {
    if (this.cancelled) {
      return;
    }
    const entry = this.takeRunningTool(name, callId);
    const isError = this.detectToolError(output);
    const label = entry?.label ?? name;
    const summary = this.summarizeToolResult(name, output, isError);
    const preview = this.toolDetail ? this.formatToolResultPreview(output) : '';
    // title/summary stay SEPARATE fields (not concatenated): the renderer
    // truncates the label against the terminal width and always keeps the
    // summary intact on the same line, so a long label cannot orphan-wrap
    // "· N lines" onto its own row. See TranscriptEvent in ink-app.tsx.
    this.addToolTrace(label, preview, { status: isError ? 'error' : 'success', summary: summary || undefined });

    const stillRunning = this.liveTools.length > 0;
    this.updateSnapshot({
      phase: stillRunning ? 'Using tool' : 'Tool completed',
      activeTool: stillRunning ? this.liveTools[this.liveTools.length - 1].name : null,
      completedTools: Math.min(this.snapshot.toolCalls, this.snapshot.completedTools + 1),
    });
  }

  stepFinished(reason: string): void {
    this.updateSnapshot({
      phase: 'Step finished',
      activeTool: null,
      lastStep: reason,
    });
  }

  user(message: string): void {
    // Terminal path: flush before anything else, or a trace still held back
    // for a possible merge is silently lost.
    this.flushPendingTrace();
    this.finalizeLiveText();
    this.addEvent('user', undefined, message);
  }

  clarification(request: ClarificationRequest): void {
    // Terminal path: flush before anything else, or a trace still held back
    // for a possible merge is silently lost.
    this.flushPendingTrace();
    this.finalizeLiveText();
    const lines = [request.question];
    if (request.context) {
      lines.push(request.context);
    }
    if (request.defaultAnswer) {
      lines.push(`Default: ${request.defaultAnswer}`);
    }
    this.addEvent('system', 'Clarification needed', lines.join('\n'));
    // `phase` drives the composer's waiting-for-answer styling in ink-app.
    this.updateSnapshot({ status: 'Waiting for clarification', phase: 'Clarification' });
  }

  /**
   * `interim` = narration between tool calls (rendered muted);
   * `final` = the answer segment that ends a run (bright + markdown).
   */
  private finalizeLiveText(kind: 'interim' | 'final' = 'final'): void {
    if (!this.liveText.trim()) {
      this.liveText = '';
      return;
    }

    const text = this.liveText;
    this.liveText = '';
    // Narration folding only ever applies to 'interim' segments — the segment
    // that ends a run ('final') is the answer and is never folded.
    const displayText = kind === 'interim' && this.narrationCollapsed ? this.collapseNarration(text) : text;
    this.addEvent('assistant', undefined, displayText, true, kind === 'interim' ? { status: 'info' } : {});
  }

  /** First line (truncated) + "… +N lines" for a folded narration segment. */
  private collapseNarration(text: string): string {
    const lines = text.trim().split('\n');
    if (lines.length <= 1) {
      return this.compactText(lines[0] ?? text, 96);
    }
    const rest = lines.length - 1;
    return `${this.compactText(lines[0], 96)} … +${rest} line${rest === 1 ? '' : 's'}`;
  }

  private finalizeLiveTools(status: 'info' | 'error', note = ''): void {
    if (this.liveTools.length === 0) {
      return;
    }

    const pending = this.liveTools;
    this.liveTools = [];
    for (const entry of pending) {
      this.addEvent('tool', entry.label, note, true, { status });
    }
  }

  private takeRunningTool(name: string, callId?: string): InkLiveTool | null {
    const byId = callId ? this.liveTools.findIndex(entry => entry.id === callId) : -1;
    const byName = this.liveTools.findIndex(entry => entry.name === name);
    const resolvedIndex = byId >= 0 ? byId : byName >= 0 ? byName : this.liveTools.length > 0 ? 0 : -1;
    if (resolvedIndex < 0) {
      return null;
    }

    const entry = this.liveTools[resolvedIndex];
    this.liveTools = this.liveTools.filter((_, i) => i !== resolvedIndex);
    return entry;
  }

  /** Human-glanceable tail of a partially-streamed JSON argument object. */
  private formatPendingInputTail(buffer: string, maxLength = 48): string {
    const stripped = buffer.replace(/[{}"\\]/g, '').replace(/\s+/g, ' ').trim();
    if (stripped.length <= maxLength) {
      return stripped || '…';
    }
    return `…${stripped.slice(-maxLength)}`;
  }

  private formatToolLabel(name: string, summary: string): string {
    const hasActionPrefix = /^\s*(\$|open |grep |find |search |edit |write |patch |ls )/.test(summary);
    return hasActionPrefix ? summary : `${name}: ${summary}`;
  }

  /**
   * One-line result summary appended to the tool label.
   * Text output: single line inlined, multi-line counted with a
   * category-appropriate noun. Structured output without a text field yields
   * no summary — never a JSON dump. Errors inline the first error line.
   */
  private summarizeToolResult(name: string, output: unknown, isError: boolean): string {
    const text = this.extractOutputText(output);
    if (text === null || !text.trim()) {
      return isError ? 'failed' : '';
    }

    const lines = this.splitOutputLines(text);
    if (isError || lines.length <= 1) {
      return this.compactText(lines[0] ?? '', isError ? 80 : 60);
    }

    const normalizedName = name.toLowerCase();
    const noun = this.isSearchTool(normalizedName) ? 'matches' : this.isListTool(normalizedName) ? 'items' : 'lines';
    return `${lines.length} ${noun}`;
  }

  private formatToolResultPreview(output: unknown, maxLines = 3): string {
    const text = this.extractOutputText(output) ?? this.compactText(this.safeStringify(output), 120);
    if (!text.trim()) {
      return '';
    }

    const lines = this.splitOutputLines(text);
    const head = lines.slice(0, maxLines).map(line => this.compactText(line, 120));
    const remaining = lines.length - head.length;
    if (remaining > 0) {
      head.push(`… +${remaining} lines`);
    }
    return head.join('\n');
  }

  private splitOutputLines(text: string): string[] {
    const lines = text.split('\n').map(line => line.trimEnd());
    while (lines.length > 0 && !lines[lines.length - 1]) {
      lines.pop();
    }
    while (lines.length > 0 && !lines[0]) {
      lines.shift();
    }
    return lines;
  }

  /** Returns the human-readable text of a tool output, or null when there is none. */
  private extractOutputText(output: unknown): string | null {
    if (output === null || output === undefined) {
      return null;
    }
    if (typeof output === 'string') {
      return output;
    }
    if (Array.isArray(output)) {
      const joined = output
        .map(part => {
          if (typeof part === 'string') return part;
          const record = this.asRecord(part);
          return typeof record?.text === 'string' ? record.text : '';
        })
        .filter(Boolean)
        .join('\n');
      return joined || null;
    }

    const record = this.asRecord(output);
    if (record) {
      if (typeof record.text === 'string') return record.text;
      if (typeof record.output === 'string') return record.output;
      if (typeof record.content === 'string') return record.content;
      if (Array.isArray(record.content)) return this.extractOutputText(record.content);
      if (typeof record.error === 'string') return record.error;
    }
    return null;
  }

  private detectToolError(output: unknown): boolean {
    const record = this.asRecord(output);
    if (record) {
      if (record.isError === true || record.is_error === true) return true;
      if (record.error !== undefined && record.error !== null && record.error !== false) return true;
    }
    if (typeof output === 'string') {
      return /^(error|failed)\b/i.test(output.trim());
    }
    return false;
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
  private addToolTrace(title: string, text: string, metadata: Pick<InkCliEvent, 'status' | 'summary'>): void {
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

    this.addEvent('tool', title, text, true, metadata);
  }

  /** Prints whatever trace is being held back for a possible merge, if any. */
  private flushPendingTrace(): void {
    if (!this.pendingTrace) {
      return;
    }
    const { title, status, summary, count } = this.pendingTrace;
    this.pendingTrace = null;
    this.addEvent('tool', count > 1 ? `${title} ·×${count}` : title, '', true, { status, summary });
  }

  private addEvent(
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
    this.events = [
      ...this.events,
      {
        id,
        kind,
        title,
        text: this.truncateEventText(text),
        ...metadata,
      },
    ];

    if (emit) {
      this.emit();
    }

    return id;
  }

  private truncateEventText(text: string): string {
    if (text.length <= MAX_EVENT_TEXT_LENGTH) {
      return text;
    }
    return `${text.slice(0, MAX_EVENT_TEXT_LENGTH)}…`;
  }

  private summarizeToolInput(name: string, value: unknown): string {
    const normalizedName = name.toLowerCase();
    const record = this.asRecord(value);

    if (record) {
      if (this.isShellTool(normalizedName)) {
        const cmd = this.pickString(record, ['command', 'cmd', 'script']) ?? this.safeStringify(record);
        return `$ ${this.compactShellCommand(cmd)}`;
      }

      if (this.isReadTool(normalizedName)) {
        const filePath = this.pickString(record, ['filePath', 'path', 'file']) ?? this.safeStringify(record);
        const offset = record['offset'];
        const limit = record['limit'];
        const fileLabel = this.shortPath(filePath);
        if (typeof offset === 'number' && typeof limit === 'number') {
          return `open ${fileLabel}:${offset}–${offset + limit}`;
        }
        if (typeof offset === 'number') {
          return `open ${fileLabel}:${offset}+`;
        }
        return `open ${fileLabel}`;
      }

      if (this.isSearchTool(normalizedName)) {
        const pattern = this.pickString(record, ['pattern', 'query', 'search']);
        const searchPath = this.pickString(record, ['path', 'cwd', 'dir', 'glob']);
        const toolVerb = normalizedName.includes('grep') ? 'grep' : normalizedName.includes('find') ? 'find' : 'search';
        if (pattern && searchPath) {
          return `${toolVerb} "${this.compactText(pattern, 40)}" in ${this.shortPath(searchPath, 40)}`;
        }
        if (pattern) return `${toolVerb} "${this.compactText(pattern, 60)}"`;
        if (searchPath) return `${toolVerb} ${this.shortPath(searchPath)}`;
        return `${toolVerb} ${this.compactText(this.safeStringify(record))}`;
      }

      if (this.isMutationTool(normalizedName)) {
        const filePath = this.pickString(record, ['filePath', 'path', 'file']) ?? this.safeStringify(record);
        const verb = normalizedName.includes('write') ? 'write' : normalizedName.includes('patch') ? 'patch' : 'edit';
        return `${verb} ${this.shortPath(filePath)}`;
      }

      if (this.isListTool(normalizedName)) {
        const dirPath = this.pickString(record, ['path', 'dir', 'cwd']) ?? '.';
        return `ls ${this.shortPath(dirPath)}`;
      }

      // 'task' first: sub-agent tools (`<name>_agent`) carry their whole
      // assignment there, and it is the one line worth showing.
      const primary = this.pickString(record, ['task', 'name', 'title', 'id', 'action', 'query']);
      if (primary) {
        return this.compactText(primary, 60);
      }
      const keys = Object.keys(record).slice(0, 3);
      return keys.length > 0 ? `input: ${keys.join(', ')}` : 'input object';
    }

    if (value === undefined || value === null) {
      return 'no input';
    }
    if (typeof value === 'string') {
      return this.compactText(value);
    }
    return this.compactText(this.safeStringify(value));
  }

  /**
   * Shorten a shell command for display:
   * - Single-line commands: compact whitespace and trim to maxLength
   * - Multi-line scripts: show first non-empty line + "…"
   */
  private compactShellCommand(cmd: string, maxLength = 80): string {
    const trimmed = cmd.trim();
    const firstNewline = trimmed.indexOf('\n');
    if (firstNewline > 0) {
      const firstLine = trimmed.slice(0, firstNewline).trim();
      return firstLine.length > maxLength
        ? `${firstLine.slice(0, maxLength)}… (+${trimmed.split('\n').length - 1} lines)`
        : `${firstLine} … (+${trimmed.split('\n').length - 1} lines)`;
    }
    const normalized = trimmed.replace(/\s+/g, ' ');
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
  }

  /**
   * Shorten a file path for display, keeping the ends over the middle:
   * - Long path: first segment + last 2 ("packages/…/src/model-registry.ts").
   *   In a monorepo the package name is the most identifying part of a path
   *   and `…/src/model-registry.ts` alone throws it away — every package has
   *   a src/ and most have a model-registry.ts-shaped file somewhere.
   * - Still too long (or too few segments for a head to mean anything):
   *   degrade to the old last-2-segments form.
   */
  private shortPath(filePath: string, maxLength = 60): string {
    const normalized = filePath.replace(/\\/g, '/').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    const parts = normalized.split('/').filter(Boolean);
    const tail = parts.slice(-2).join('/');
    if (parts.length > 3) {
      const withHead = `${parts[0]}/…/${tail}`;
      if (withHead.length <= maxLength) {
        return withHead;
      }
    }
    return `…/${tail}`;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private pickString(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private compactText(value: string, maxLength = 96): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
  }

  /**
   * Whole-word tool-name classification. Substring matching misfires on
   * embedded words — `researcher_agent` contains "search" and was summarized
   * as a search tool, whose fallback dumped the raw input JSON into every
   * trace. Tokens split on `_`/`-`/`.` so `web_search` still matches.
   */
  private nameHasWord(name: string, words: string[]): boolean {
    const tokens = name.split(/[^a-z0-9]+/);
    return tokens.some(token => words.includes(token));
  }

  private isShellTool(name: string): boolean {
    return this.nameHasWord(name, ['bash', 'shell', 'exec', 'command', 'cmd']);
  }

  private isReadTool(name: string): boolean {
    return this.nameHasWord(name, ['read', 'cat', 'open']);
  }

  private isSearchTool(name: string): boolean {
    return this.nameHasWord(name, ['grep', 'search', 'find']);
  }

  private isMutationTool(name: string): boolean {
    return this.nameHasWord(name, ['edit', 'write', 'patch']);
  }

  private isListTool(name: string): boolean {
    // Only filesystem-style listers: `task_list` and friends must not be
    // summarized as `ls <path>`.
    return name === 'ls' || name === 'list' || name.startsWith('list_');
  }

  private safeStringify(value: unknown): string {
    try {
      if (typeof value === 'string') {
        return value;
      }
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = ms / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }
}
