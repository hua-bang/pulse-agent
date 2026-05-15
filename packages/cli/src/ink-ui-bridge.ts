import type { ClarificationRequest } from 'pulse-coder-engine';

import type { TuiHelpItem, TuiRunSummary, TuiSessionSnapshot } from './tui-renderer.js';
import type { InkCliEvent, InkCliSnapshot } from './ink-app.js';

export interface InkUiSnapshot extends Omit<InkCliSnapshot, 'events'> {}

interface InkUiBridgeOptions {
  maxEvents?: number;
  onChange: (snapshot: InkCliSnapshot) => void;
}

type ToolActivityStatus = 'running' | 'success' | 'error';

interface ToolActivityCall {
  id: string;
  name: string;
  summary: string;
  status: ToolActivityStatus;
}

const DEFAULT_SNAPSHOT: InkUiSnapshot = {
  sessionId: null,
  taskListId: null,
  mode: null,
  messages: 0,
  estimatedTokens: 0,
  queuedInputs: 0,
  isProcessing: false,
  status: 'Ready',
  phase: 'Idle',
  activeTool: null,
  toolCalls: 0,
  completedTools: 0,
  lastStep: null,
};

const MAX_EVENT_TEXT_LENGTH = 4000;

export class InkUiBridge {
  private snapshot: InkUiSnapshot = { ...DEFAULT_SNAPSHOT };
  private events: InkCliEvent[] = [];
  private eventCounter = 0;
  private activeAssistantEventId: string | null = null;
  private toolActivityEventId: string | null = null;
  private toolActivityCalls: ToolActivityCall[] = [];
  private readonly maxEvents: number;
  private readonly onChange: (snapshot: InkCliSnapshot) => void;

  constructor(options: InkUiBridgeOptions) {
    this.maxEvents = options.maxEvents ?? 80;
    this.onChange = options.onChange;
  }

  getSnapshot(): InkCliSnapshot {
    return {
      ...this.snapshot,
      events: this.events,
    };
  }

  emit(): void {
    this.onChange(this.getSnapshot());
  }

  updateSnapshot(partial: Partial<InkUiSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
    };
    this.emit();
  }

  showWelcome(): void {
    this.addEvent('system', 'Welcome', 'Type a message and press Enter to run the agent. Use /help for commands. Shift+Tab cycles CLI mode. Esc stops the current response; Ctrl+C exits safely.');
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
      'Input: Enter send, Ctrl+J newline, ↑/↓ history, ←/→ move cursor, Ctrl+A/E jump',
      'Editing: Ctrl+U delete before cursor, Ctrl+K delete after cursor, Ctrl+W delete previous word',
      'Control: Esc stops a run; when idle it clears input first, then exits on empty input',
      'Display: Ctrl+L clears the visible transcript only; /clear resets conversation context',
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

  runSummary(summary: TuiRunSummary): void {
    this.activeAssistantEventId = null;
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
      this.activeAssistantEventId = null;
      this.emit();
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
    this.activeAssistantEventId = null;
    this.updateSnapshot({
      isProcessing: false,
      status: 'Cancelled',
      phase: 'Cancelled',
      activeTool: null,
    });
    this.addEvent('error', 'Abort', message);
  }

  startProcessing(label = 'Processing'): void {
    this.activeAssistantEventId = null;
    this.toolActivityEventId = null;
    this.toolActivityCalls = [];
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
    this.updateSnapshot({
      isProcessing: false,
      status: 'Ready',
      phase: 'Idle',
      activeTool: null,
    });
  }

  text(delta: string): void {
    if (!this.activeAssistantEventId) {
      this.activeAssistantEventId = this.addEvent('assistant', undefined, '', false);
    }

    this.updateEvent(this.activeAssistantEventId, event => ({
      ...event,
      text: this.truncateEventText(`${event.text}${delta}`),
    }));
  }

  toolCall(name: string, input?: unknown): void {
    this.activeAssistantEventId = null;
    const nextToolCalls = this.snapshot.toolCalls + 1;
    const call: ToolActivityCall = {
      id: `tool-${nextToolCalls}`,
      name,
      summary: this.summarizeToolInput(name, input),
      status: 'running',
    };
    this.toolActivityCalls = [...this.toolActivityCalls, call];
    this.upsertToolActivityEvent();
    this.updateSnapshot({
      phase: 'Using tool',
      activeTool: name,
      toolCalls: nextToolCalls,
      status: `Running tool: ${name}`,
    });
  }

  toolResult(name: string): void {
    const nextCompletedTools = Math.min(this.snapshot.toolCalls, this.snapshot.completedTools + 1);
    const runningIndex = this.findRunningToolIndex(name);
    if (runningIndex >= 0) {
      this.toolActivityCalls = this.toolActivityCalls.map((call, index) => index === runningIndex ? {
        ...call,
        name: call.name || name,
        status: 'success',
      } : call);
    }
    this.upsertToolActivityEvent();

    this.updateSnapshot({
      phase: 'Tool completed',
      activeTool: null,
      completedTools: nextCompletedTools,
      status: `Completed tool: ${name}`,
    });
  }

  stepFinished(reason: string): void {
    this.addEvent('system', 'Step finished', reason, true, { status: 'info' });
    this.updateSnapshot({
      phase: 'Step finished',
      activeTool: null,
      lastStep: reason,
    });
  }

  user(message: string): void {
    this.addEvent('user', undefined, message);
  }

  clarification(request: ClarificationRequest): void {
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

  private upsertToolActivityEvent(): void {
    if (this.toolActivityCalls.length === 0) {
      return;
    }

    const status = this.toolActivityCalls.some(call => call.status === 'running') ? 'running' : 'success';
    const title = 'Tools';
    const text = this.formatToolActivityText();
    const summary = this.formatToolActivitySummary();

    if (!this.toolActivityEventId || !this.events.some(event => event.id === this.toolActivityEventId)) {
      this.toolActivityEventId = this.addEvent('tool', title, text, false, { status, summary });
      this.emit();
      return;
    }

    this.updateEvent(this.toolActivityEventId, event => ({
      ...event,
      title,
      text,
      status,
      summary,
    }));
  }

  private findRunningToolIndex(name: string): number {
    const sameNameIndex = this.toolActivityCalls.findIndex(call => call.status === 'running' && call.name === name);
    if (sameNameIndex >= 0) {
      return sameNameIndex;
    }
    return this.toolActivityCalls.findIndex(call => call.status === 'running');
  }

  private formatToolActivityText(): string {
    const counts = this.countToolNames();
    const groupedTools = Object.entries(counts)
      .map(([tool, count]) => count > 1 ? `${tool} ×${count}` : tool)
      .join(' · ');
    const latestCalls = this.toolActivityCalls.slice(-5).map(call => {
      const icon = call.status === 'success' ? '✓' : call.status === 'error' ? '✕' : '·';
      // If summary already has an action prefix, skip repeating the tool name
      const hasActionPrefix = /^\s*(\$|open |grep |find |search |edit |write |patch |ls )/.test(call.summary);
      const label = hasActionPrefix ? call.summary : `${call.name}: ${call.summary}`;
      return `  ${icon} ${label}`;
    });
    const lines = [`  ${groupedTools || 'No tools yet'}`];

    if (latestCalls.length > 0) {
      lines.push('', ...latestCalls);
    }

    return lines.join('\n');
  }

  private formatToolActivitySummary(): string {
    const total = this.toolActivityCalls.length;
    const completed = this.toolActivityCalls.filter(call => call.status === 'success').length;
    const running = this.toolActivityCalls.find(call => call.status === 'running');
    const callLabel = total === 1 ? 'call' : 'calls';
    return running ? `${total} ${callLabel} · ${completed} done · running ${running.name}` : `${total} ${callLabel} · ${completed} done`;
  }

  private countToolNames(): Record<string, number> {
    return this.toolActivityCalls.reduce<Record<string, number>>((counts, call) => {
      const toolName = call.name || 'tool';
      counts[toolName] = (counts[toolName] ?? 0) + 1;
      return counts;
    }, {});
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
    ].slice(-this.maxEvents);

    if (emit) {
      this.emit();
    }

    return id;
  }

  private updateEvent(id: string, updater: (event: InkCliEvent) => InkCliEvent): void {
    this.events = this.events.map(event => event.id === id ? updater(event) : event);
    this.emit();
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
      return JSON.stringify(value, null, 2);
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
