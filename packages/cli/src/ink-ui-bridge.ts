import type { ClarificationRequest } from 'pulse-coder-engine';

import type { TuiHelpItem, TuiRunSummary, TuiSessionSnapshot } from './tui-renderer.js';
import type { InkCliEvent, InkCliSnapshot, InkLiveTool } from './ink-app.js';

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
  queuedInputs: 0,
  isProcessing: false,
  status: 'Ready',
  phase: 'Idle',
  activeTool: null,
  toolCalls: 0,
  completedTools: 0,
  lastStep: null,
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

  usage(usage: { inputTokens?: number; outputTokens?: number }): void {
    this.updateSnapshot({
      ...(typeof usage.inputTokens === 'number' ? { usageInputTokens: usage.inputTokens } : {}),
      ...(typeof usage.outputTokens === 'number' ? { usageOutputTokens: usage.outputTokens } : {}),
    });
  }

  runSummary(summary: TuiRunSummary): void {
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
      toolCalls: summary.toolCalls,
      completedTools: summary.toolCalls,
    });
  }

  section(title: string, lines: string[]): void {
    this.addEvent('system', title, lines.join('\n'));
  }

  plain(message = ''): void {
    if (!message) {
      this.finalizeLiveText();
      return;
    }

    this.addEvent('system', undefined, message);
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
    this.addEvent('error', undefined, message);
  }

  queued(message: string): void {
    this.addEvent('system', 'Queued', message);
  }

  abort(message: string): void {
    this.finalizeLiveText();
    this.finalizeLiveTools('error', '(cancelled)');
    this.updateSnapshot({
      isProcessing: false,
      status: 'Cancelled',
      phase: 'Cancelled',
      activeTool: null,
    });
    this.addEvent('error', 'Abort', message);
  }

  startProcessing(label = 'Processing'): void {
    this.liveText = '';
    this.liveTools = [];
    this.updateSnapshot({
      isProcessing: true,
      status: label,
      phase: label,
      activeTool: null,
      toolCalls: 0,
      completedTools: 0,
      lastStep: null,
    });
  }

  stopProcessing(): void {
    this.finalizeLiveText();
    this.finalizeLiveTools('info');
    this.updateSnapshot({
      isProcessing: false,
      status: 'Ready',
      phase: 'Idle',
      activeTool: null,
    });
  }

  text(delta: string): void {
    this.liveText = this.truncateEventText(`${this.liveText}${delta}`);
    this.emitThrottled();
  }

  toolCall(name: string, input?: unknown): void {
    this.finalizeLiveText();
    const label = this.formatToolLabel(name, this.summarizeToolInput(name, input));
    this.liveTools = [...this.liveTools, {
      id: `live-tool-${++this.liveToolCounter}`,
      name,
      label,
    }];
    this.updateSnapshot({
      phase: 'Using tool',
      activeTool: name,
      toolCalls: this.snapshot.toolCalls + 1,
      status: `Running tool: ${name}`,
    });
  }

  toolResult(name: string, output?: unknown): void {
    const entry = this.takeRunningTool(name);
    const isError = this.detectToolError(output);
    const preview = this.formatToolResultPreview(output);
    this.addEvent('tool', entry?.label ?? name, preview, true, { status: isError ? 'error' : 'success' });

    const stillRunning = this.liveTools.length > 0;
    this.updateSnapshot({
      phase: stillRunning ? 'Using tool' : 'Tool completed',
      activeTool: stillRunning ? this.liveTools[this.liveTools.length - 1].name : null,
      completedTools: Math.min(this.snapshot.toolCalls, this.snapshot.completedTools + 1),
      status: `${isError ? 'Tool failed' : 'Completed tool'}: ${name}`,
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
    this.finalizeLiveText();
    this.addEvent('user', undefined, message);
  }

  clarification(request: ClarificationRequest): void {
    this.finalizeLiveText();
    const lines = [request.question];
    if (request.context) {
      lines.push(request.context);
    }
    if (request.defaultAnswer) {
      lines.push(`Default: ${request.defaultAnswer}`);
    }
    this.addEvent('system', 'Clarification needed', lines.join('\n'));
    this.updateSnapshot({ status: 'Waiting for clarification' });
  }

  private finalizeLiveText(): void {
    if (!this.liveText.trim()) {
      this.liveText = '';
      return;
    }

    const text = this.liveText;
    this.liveText = '';
    this.addEvent('assistant', undefined, text);
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

  private takeRunningTool(name: string): InkLiveTool | null {
    const index = this.liveTools.findIndex(entry => entry.name === name);
    const resolvedIndex = index >= 0 ? index : this.liveTools.length > 0 ? 0 : -1;
    if (resolvedIndex < 0) {
      return null;
    }

    const entry = this.liveTools[resolvedIndex];
    this.liveTools = this.liveTools.filter((_, i) => i !== resolvedIndex);
    return entry;
  }

  private formatToolLabel(name: string, summary: string): string {
    const hasActionPrefix = /^\s*(\$|open |grep |find |search |edit |write |patch |ls )/.test(summary);
    return hasActionPrefix ? summary : `${name}: ${summary}`;
  }

  private formatToolResultPreview(output: unknown, maxLines = 3): string {
    const text = this.extractOutputText(output);
    if (!text.trim()) {
      return '';
    }

    const lines = text.split('\n').map(line => line.trimEnd());
    while (lines.length > 0 && !lines[lines.length - 1]) {
      lines.pop();
    }

    const head = lines.slice(0, maxLines).map(line => this.compactText(line, 120));
    const remaining = lines.length - head.length;
    if (remaining > 0) {
      head.push(`… +${remaining} lines`);
    }
    return head.join('\n');
  }

  private extractOutputText(output: unknown): string {
    if (output === null || output === undefined) {
      return '';
    }
    if (typeof output === 'string') {
      return output;
    }
    if (Array.isArray(output)) {
      return output
        .map(part => {
          if (typeof part === 'string') return part;
          const record = this.asRecord(part);
          return typeof record?.text === 'string' ? record.text : '';
        })
        .filter(Boolean)
        .join('\n');
    }

    const record = this.asRecord(output);
    if (record) {
      if (typeof record.text === 'string') return record.text;
      if (typeof record.output === 'string') return record.output;
      if (Array.isArray(record.content)) return this.extractOutputText(record.content);
      if (typeof record.error === 'string') return record.error;
    }
    return this.compactText(this.safeStringify(output), 300);
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

  private addEvent(
    kind: InkCliEvent['kind'],
    title: string | undefined,
    text: string,
    emit = true,
    metadata: Pick<InkCliEvent, 'status' | 'summary'> = {},
  ): string {
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
          return `${toolVerb} "${this.compactText(pattern, 40)}" in ${this.shortPath(searchPath)}`;
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
   * Shorten a file path for display:
   * - Keep last 2 segments if path is long (e.g. "src/foo.ts" or "…/bar/baz.ts")
   */
  private shortPath(filePath: string, maxLength = 60): string {
    const normalized = filePath.replace(/\\/g, '/').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    const parts = normalized.split('/').filter(Boolean);
    const short = parts.slice(-2).join('/');
    return `…/${short}`;
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

  private isShellTool(name: string): boolean {
    return name.includes('bash') || name.includes('shell') || name.includes('exec') || name.includes('command');
  }

  private isReadTool(name: string): boolean {
    return name.includes('read') || name.includes('cat') || name.includes('open');
  }

  private isSearchTool(name: string): boolean {
    return name.includes('grep') || name.includes('search') || name.includes('find');
  }

  private isMutationTool(name: string): boolean {
    return name.includes('edit') || name.includes('write') || name.includes('patch');
  }

  private isListTool(name: string): boolean {
    return name === 'ls' || name.includes('list');
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
