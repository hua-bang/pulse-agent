import type { ClarificationRequest } from 'pulse-coder-engine';

import type { TuiHelpItem, TuiRunSummary, TuiSessionSnapshot } from './tui-renderer.js';
import type { InkCliEvent, InkCliSnapshot } from './ink-app.js';

export interface InkUiSnapshot extends Omit<InkCliSnapshot, 'events'> {}

interface InkUiBridgeOptions {
  maxEvents?: number;
  onChange: (snapshot: InkCliSnapshot) => void;
}

const DEFAULT_SNAPSHOT: InkUiSnapshot = {
  sessionId: null,
  taskListId: null,
  mode: null,
  messages: 0,
  estimatedTokens: 0,
  isProcessing: false,
  status: 'Ready',
};

const MAX_EVENT_TEXT_LENGTH = 4000;

export class InkUiBridge {
  private snapshot: InkUiSnapshot = { ...DEFAULT_SNAPSHOT };
  private events: InkCliEvent[] = [];
  private eventCounter = 0;
  private activeAssistantEventId: string | null = null;
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
    this.addEvent('system', 'Welcome', 'Type a message and press Enter to run the agent. Use /help for commands. Esc stops the current response; Ctrl+C exits safely.');
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
    });
    this.addEvent('error', 'Abort', message);
  }

  startProcessing(label = 'Processing'): void {
    this.activeAssistantEventId = null;
    this.updateSnapshot({
      isProcessing: true,
      status: label,
    });
  }

  stopProcessing(): void {
    this.updateSnapshot({
      isProcessing: false,
      status: 'Ready',
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
    const inputText = input === undefined ? '' : `\n${this.safeStringify(input)}`;
    this.addEvent('tool', name, `Running${inputText}`);
  }

  toolResult(name: string): void {
    this.addEvent('result', name, 'Completed');
  }

  stepFinished(reason: string): void {
    this.addEvent('system', 'Step finished', reason);
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

  private addEvent(kind: InkCliEvent['kind'], title: string | undefined, text: string, emit = true): string {
    const id = `event-${++this.eventCounter}`;
    this.events = [
      ...this.events,
      {
        id,
        kind,
        title,
        text: this.truncateEventText(text),
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
