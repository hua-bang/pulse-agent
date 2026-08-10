import type { ClarificationRequest } from 'pulse-coder-engine';

import type { TuiHelpItem, TuiRunSummary, TuiSessionSnapshot } from '../shared/tui-types.js';
import type { InkCliEvent, InkPickerState } from './ink-app.js';
import type { InkUiSnapshot } from './ink-ui-bridge.js';

/**
 * The bridge's thin message surface: every method here just shapes text into
 * transcript events or snapshot updates through the abstract primitives the
 * concrete bridge implements (event log, live region, snapshot). Keeping it
 * a base class keeps InkUiBridge's public API in one type while the state
 * machinery lives with the state.
 */
export abstract class InkUiBridgeSurface {
  abstract updateSnapshot(partial: Partial<InkUiSnapshot>): void;
  abstract getToolDetail(): boolean;
  abstract getNarrationCollapse(): boolean;
  protected abstract addEvent(kind: InkCliEvent['kind'], title: string | undefined, text: string, emit?: boolean, metadata?: Pick<InkCliEvent, 'status' | 'summary'>): string;
  protected abstract flushPendingTrace(): void;
  protected abstract finalizeLiveText(kind?: 'interim' | 'final'): void;
  protected abstract finalizeLiveTools(status: 'info' | 'error', note?: string): void;
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
      `Tool trace detail: Ctrl+O toggles (currently ${this.getToolDetail() ? 'on' : 'off'})`,
      `Narration folding: Ctrl+T or /narration on|off toggles (currently ${this.getNarrationCollapse() ? 'on' : 'off'})`,
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
