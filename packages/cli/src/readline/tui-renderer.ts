import { BOLD, CYAN, DIM, GREEN, MAGENTA, RED, RESET, YELLOW, formatDuration, formatToolInput, renderBox } from './tui-format.js';
import { TuiSpinner } from './tui-spinner.js';
import type { TuiHelpItem, TuiRunSummary, TuiSessionSnapshot } from '../shared/tui-types.js';

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

export class TuiRenderer {
  private readonly output: OutputLike;
  private readonly canUseTui: boolean;
  private enabled: boolean;
  private readonly now: () => number;
  private readonly spinner: TuiSpinner;

  constructor(options: TuiRendererOptions = {}) {
    this.output = options.output ?? process.stdout;
    const env = options.env ?? process.env;
    this.canUseTui = this.detectAvailable(env);
    this.enabled = options.enabled ?? this.detectDefaultEnabled(env);
    this.now = options.now ?? (() => Date.now());
    this.spinner = new TuiSpinner({
      write: chunk => this.write(chunk),
      clearLine: () => this.clearLine(),
      color: (value, code) => this.color(value, code),
      now: () => this.now(),
    });
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

    this.writeLine(this.renderBoxWith('Pulse Coder CLI', [
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
    this.writeLine(`\n${this.renderBoxWith('Commands', lines)}`);
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
    const elapsed = formatDuration(summary.elapsedMs);
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

    this.writeLine(`\n${this.renderBoxWith('Run Summary', lines)}`);
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

    this.writeLine(`\n${this.renderBoxWith(title, lines)}`);
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

    this.spinner.start(label);
  }

  stopProcessing(): void {
    this.spinner.stop();
  }

  text(delta: string): void {
    this.stopProcessing();
    this.write(delta);
  }

  toolCall(name: string, input?: unknown): void {
    this.stopProcessing();
    const preview = input === undefined ? [] : formatToolInput(input);

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

  private renderBoxWith(title: string, lines: string[]): string {
    return renderBox(title, lines, (value, code) => this.color(value, code), this.output.columns);
  }

  private clearLine(): void {
    if (!this.enabled) {
      return;
    }

    this.output.clearLine?.(0);
    this.output.cursorTo?.(0);
  }

  private color(value: string, code: string): string {
    return this.enabled ? `${code}${value}${RESET}` : value;
  }

  private writeLine(line: string): void {
    this.write(`${line}\n`);
  }

  private write(chunk: string): void {
    this.output.write(chunk);
  }
}
