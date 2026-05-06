export interface TuiHelpItem {
  command: string;
  description: string;
}

export interface TuiRunSummary {
  elapsedMs: number;
  toolCalls: number;
  messages: number;
  estimatedTokens: number;
  mode?: string | null;
}

export interface TuiSessionSnapshot {
  sessionId?: string | null;
  taskListId?: string | null;
  messages: number;
  estimatedTokens: number;
  mode?: string | null;
}

interface OutputLike {
  isTTY?: boolean;
  columns?: number;
  write(chunk: string): boolean;
  clearLine?(dir: number): boolean;
  cursorTo?(x: number): boolean;
}

interface TuiRendererOptions {
  output?: OutputLike;
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';
const CYAN = '\u001b[36m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const RED = '\u001b[31m';
const MAGENTA = '\u001b[35m';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class TuiRenderer {
  private readonly output: OutputLike;
  private readonly canUseTui: boolean;
  private enabled: boolean;
  private readonly now: () => number;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerIndex = 0;
  private spinnerLabel = 'Processing';
  private spinnerStartedAt = 0;
  private statusLineActive = false;

  constructor(options: TuiRendererOptions = {}) {
    this.output = options.output ?? process.stdout;
    const env = options.env ?? process.env;
    this.canUseTui = this.detectAvailable(env);
    this.enabled = options.enabled ?? this.detectDefaultEnabled(env);
    this.now = options.now ?? (() => Date.now());
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isAvailable(): boolean {
    return this.canUseTui;
  }

  setEnabled(enabled: boolean): boolean {
    this.stopProcessing();
    if (enabled && !this.canUseTui) {
      this.enabled = false;
      return false;
    }

    this.enabled = enabled;
    return true;
  }

  prompt(mode: 'default' | 'teams' = 'default'): string {
    if (!this.enabled) {
      return mode === 'teams' ? 'teams> ' : '> ';
    }

    const label = mode === 'teams' ? `${MAGENTA}teams›${RESET}` : `${CYAN}›${RESET}`;
    return `${label} `;
  }

  showWelcome(): void {
    if (!this.enabled) {
      this.writeLine('🚀 Pulse Coder CLI is running...');
      this.writeLine('Type your messages and press Enter. Type "exit" to quit.');
      this.writeLine('Press Esc to stop current response and continue with new input.');
      this.writeLine('Press Ctrl+C to exit CLI.');
      this.writeLine('Commands starting with "/" will trigger command mode.\n');
      return;
    }

    this.writeLine(this.box('Pulse Coder CLI', [
      'Type a message and press Enter to run the agent.',
      'Use /help for commands, /status for session details, /tui to tune the interface.',
      'Esc stops the current response; Ctrl+C exits safely.',
    ]));
  }

  showHelp(items: TuiHelpItem[], footer: string[] = []): void {
    if (!this.enabled) {
      this.writeLine('\n📋 Available commands:');
      for (const item of items) {
        this.writeLine(`${item.command} - ${item.description}`);
      }
      for (const line of footer) {
        this.writeLine(line);
      }
      return;
    }

    const commandWidth = Math.max(...items.map(item => item.command.length));
    const lines = items.map(item => `${this.color(item.command.padEnd(commandWidth), CYAN)}  ${item.description}`);
    if (footer.length > 0) {
      lines.push('', ...footer.map(line => this.color(line, DIM)));
    }
    this.writeLine(`\n${this.box('Commands', lines)}`);
  }

  showPluginStatus(count: number): void {
    this.success(`Built-in plugins loaded: ${count} plugins`);
  }

  showTuiStatus(): void {
    this.section('TUI Status', [
      `Enabled: ${this.enabled ? 'yes' : 'no'}`,
      `Available: ${this.canUseTui ? 'yes' : 'no'}`,
      'Use /tui on or /tui off to switch for this process.',
      'Use PULSE_CODER_PLAIN=1 to start in plain mode.',
    ]);
  }

  session(snapshot: TuiSessionSnapshot): void {
    if (!this.enabled) {
      return;
    }

    const parts = [
      `session ${snapshot.sessionId ?? 'new'}`,
      `${snapshot.messages} msgs`,
      `~${snapshot.estimatedTokens} tokens`,
    ];
    if (snapshot.taskListId) {
      parts.push(`tasks ${snapshot.taskListId}`);
    }
    if (snapshot.mode) {
      parts.push(`mode ${snapshot.mode}`);
    }

    this.writeLine(this.color(`╭ ${parts.join(' · ')}`, DIM));
  }

  runSummary(summary: TuiRunSummary): void {
    this.stopProcessing();
    const elapsed = this.formatDuration(summary.elapsedMs);
    const lines = [
      `Elapsed: ${elapsed}`,
      `Tools: ${summary.toolCalls}`,
      `Messages: ${summary.messages}`,
      `Estimated tokens: ~${summary.estimatedTokens}`,
      ...(summary.mode ? [`Mode: ${summary.mode}`] : []),
    ];

    if (!this.enabled) {
      this.writeLine(`\nDone in ${elapsed} · tools ${summary.toolCalls} · messages ${summary.messages} · ~${summary.estimatedTokens} tokens`);
      return;
    }

    this.writeLine(`\n${this.box('Run Summary', lines)}`);
  }

  section(title: string, lines: string[]): void {
    this.stopProcessing();
    if (!this.enabled) {
      this.writeLine(`\n${title}:`);
      for (const line of lines) {
        this.writeLine(line);
      }
      return;
    }

    this.writeLine(`\n${this.box(title, lines)}`);
  }

  plain(message = ''): void {
    this.stopProcessing();
    this.writeLine(message);
  }

  inline(message = ''): void {
    this.stopProcessing();
    this.write(message);
  }

  startProcessing(label = 'Processing'): void {
    if (!this.enabled) {
      this.writeLine('\n🔄 Processing...\n');
      return;
    }

    this.stopProcessing();
    this.spinnerLabel = label;
    this.spinnerStartedAt = this.now();
    this.spinnerIndex = 0;
    this.write('\n');
    this.renderSpinner();
    this.spinnerTimer = setInterval(() => this.renderSpinner(), 120);
  }

  stopProcessing(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }

    if (this.statusLineActive) {
      this.clearLine();
      this.statusLineActive = false;
    }
  }

  text(delta: string): void {
    this.stopProcessing();
    this.write(delta);
  }

  toolCall(name: string, input?: unknown): void {
    this.stopProcessing();
    const preview = input === undefined ? [] : this.formatToolInput(input);

    if (!this.enabled) {
      const inputText = preview.length === 0 ? '' : ` ${preview.join(' ')}`;
      this.writeLine(`\n🔧 ${name}${inputText}`);
      return;
    }

    if (preview.length === 0) {
      this.writeLine(`\n${this.color('🔧', CYAN)} ${this.color(name, BOLD)}`);
      return;
    }

    this.writeLine(`\n${this.color('🔧', CYAN)} ${this.color(name, BOLD)}`);
    for (const line of preview) {
      this.writeLine(`   ${this.color(line, DIM)}`);
    }
  }

  toolResult(name: string): void {
    this.stopProcessing();
    this.writeLine(`\n${this.color('✅', GREEN)} ${name}`);
  }

  stepFinished(reason: string): void {
    this.stopProcessing();
    this.writeLine(`\n${this.color('📋', MAGENTA)} Step finished: ${reason}`);
  }

  info(message: string): void {
    this.stopProcessing();
    this.writeLine(`${this.color('ℹ', CYAN)} ${message}`);
  }

  success(message: string): void {
    this.stopProcessing();
    this.writeLine(`${this.color('✅', GREEN)} ${message}`);
  }

  warn(message: string): void {
    this.stopProcessing();
    this.writeLine(`${this.color('⚠', YELLOW)} ${message}`);
  }

  error(message: string): void {
    this.stopProcessing();
    this.writeLine(`${this.color('❌', RED)} ${message}`);
  }

  abort(message: string): void {
    this.stopProcessing();
    this.writeLine(`\n${this.color('[Abort]', YELLOW)} ${message}`);
  }

  queued(message: string): void {
    this.stopProcessing();
    this.writeLine(`\n${this.color('📝', CYAN)} ${message}`);
  }

  private detectAvailable(env: NodeJS.ProcessEnv): boolean {
    return Boolean(this.output.isTTY) && !env.NO_COLOR && env.TERM !== 'dumb';
  }

  private detectDefaultEnabled(env: NodeJS.ProcessEnv): boolean {
    return this.canUseTui && env.PULSE_CODER_PLAIN !== '1';
  }

  private box(title: string, lines: string[]): string {
    const visibleLines = lines.map(line => this.stripAnsi(line));
    const maxLineLength = Math.max(title.length + 2, ...visibleLines.map(line => line.length));
    const maxWidth = Math.max(42, Math.min(this.output.columns ?? 80, 96) - 4);
    const width = Math.min(Math.max(maxLineLength, 42), maxWidth);
    const top = `╭─ ${this.color(title, BOLD)} ${'─'.repeat(Math.max(0, width - title.length - 3))}╮`;
    const bottom = `╰${'─'.repeat(width + 2)}╯`;
    const body = lines.flatMap(line => this.wrapVisible(line, width)).map(line => {
      const padding = width - this.stripAnsi(line).length;
      return `│ ${line}${' '.repeat(Math.max(0, padding))} │`;
    });

    return [top, ...body, bottom].join('\n');
  }

  private renderSpinner(): void {
    const frame = SPINNER_FRAMES[this.spinnerIndex % SPINNER_FRAMES.length];
    this.spinnerIndex += 1;
    const elapsed = Math.max(0, Math.floor((this.now() - this.spinnerStartedAt) / 1000));
    const line = `${this.color(frame, CYAN)} ${this.spinnerLabel} ${this.color(`${elapsed}s`, DIM)} ${this.color('Esc to stop', DIM)}`;
    this.clearLine();
    this.write(line);
    this.statusLineActive = true;
  }

  private clearLine(): void {
    if (!this.enabled) {
      return;
    }

    this.output.clearLine?.(0);
    this.output.cursorTo?.(0);
  }

  private wrapVisible(line: string, width: number): string[] {
    if (this.stripAnsi(line).length <= width) {
      return [line];
    }

    const plain = this.stripAnsi(line);
    const wrapped: string[] = [];
    for (let index = 0; index < plain.length; index += width) {
      wrapped.push(plain.slice(index, index + width));
    }
    return wrapped;
  }

  private formatToolInput(value: unknown): string[] {
    const maxLineLength = 96;
    const maxLines = 4;
    const json = this.safeJson(value);
    const pretty = this.prettyJson(value) ?? json;
    const sourceLines = pretty.split('\n');
    const lines: string[] = [];

    for (const sourceLine of sourceLines) {
      const trimmed = sourceLine.trimEnd();
      if (!trimmed) {
        continue;
      }
      lines.push(this.truncate(trimmed, maxLineLength));
      if (lines.length >= maxLines) {
        break;
      }
    }

    if (sourceLines.length > maxLines || json.length > lines.join('\n').length) {
      const remaining = Math.max(0, json.length - lines.join('\n').length);
      lines.push(`… truncated ${remaining} chars`);
    }

    return lines;
  }

  private safeJson(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private prettyJson(value: unknown): string | null {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return null;
    }
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength - 1)}…`;
  }

  private formatDuration(ms: number): string {
    if (ms < 1_000) {
      return `${Math.max(0, Math.round(ms))}ms`;
    }

    const seconds = ms / 1_000;
    if (seconds < 60) {
      return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return `${minutes}m ${remainder}s`;
  }

  private color(value: string, code: string): string {
    return this.enabled ? `${code}${value}${RESET}` : value;
  }

  private stripAnsi(value: string): string {
    return value.replace(/\u001b\[[0-9;]*m/g, '');
  }

  private writeLine(line: string): void {
    this.write(`${line}\n`);
  }

  private write(chunk: string): void {
    this.output.write(chunk);
  }
}
