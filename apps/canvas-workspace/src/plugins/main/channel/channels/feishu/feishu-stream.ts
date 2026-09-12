import type * as lark from '@larksuiteoapi/node-sdk';
import type { ChannelStream } from '../../core/types';
import { sendImageMessage, sendTextMessage, sendCardMessage, updateCardMessage, type FeishuSendTarget } from './feishu-client';
import { buildReplyCard, buildDoneCard, buildErrorCard, buildProgressCard, buildThinkingCard, formatToolLabel, formatStreamingToolLabel } from './card';
import { FeishuRunCard } from './run-card';
import { FeishuRunActions } from './run-actions';

const PROGRESS_THROTTLE_MS = 800;
const PROGRESS_HEARTBEAT_MS = 1_200;
const CARD_SEND_TIMEOUT_MS = 10_000;
const CARD_UPDATE_TIMEOUT_MS = 10_000;

/**
 * Renders a run into a streamed process card plus a separate response card. Events are
 * accumulated and flushed to the card on a trailing throttle so we don't
 * exceed Feishu's update-rate limits; images are sent as separate messages.
 */
interface ToolRun {
  id?: string;
  name: string;
  label: string;
  beforeText?: string;
  startedAt: number;
  done: boolean;
  elapsedSec?: number;
  inputBytes?: number;
  inputPreview?: string;
  inputStreaming?: boolean;
  argsReceived?: boolean;
}

export class FeishuStream implements ChannelStream {
  private cardMessageId: string | null = null;
  private readonly runCard: FeishuRunCard;
  private cardFailed = false;
  private replyMessageId: string | null = null;
  private replyTimedOut = false;
  private replySnapshot = '';
  private stopControl?: () => void;
  private stopping = false;
  private started = false;
  private readonly stopToken: string;
  private accumulated = '';
  /** Every tool call this run, accumulated as a live list for the card. */
  private readonly tools: ToolRun[] = [];
  private readonly startedAt = Date.now();

  private updateInFlight: Promise<boolean> | null = null;
  private pendingProgressFactory: (() => object) | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastFlush = 0;
  private finalizing = false;
  private cardUpdateTimedOut = false;

  constructor(
    private readonly client: lark.Client,
    private readonly target: FeishuSendTarget,
    private readonly actions = new FeishuRunActions(),
  ) {
    this.runCard = new FeishuRunCard(client, target);
    this.stopToken = actions.token();
  }

  async init(): Promise<void> {
    try {
      this.cardMessageId = await withTimeout(
        this.runCard.open(buildThinkingCard()),
        CARD_SEND_TIMEOUT_MS,
        'Feishu thinking card send',
      );
    } catch (err) {
      // If the initial card cannot be sent, fall back to text messages.
      this.runCard.abandon();
      this.cardFailed = true;
      console.error('[channel:feishu] failed to send thinking card', err);
    }
    try {
      const reply = this.replyProgress();
      this.replyMessageId = await withTimeout(sendCardMessage(this.client, this.target, reply), CARD_SEND_TIMEOUT_MS, 'Feishu reply card send');
      this.replySnapshot = JSON.stringify(reply);
      if (this.target.requesterId) this.actions.register(this.stopToken, {
        messageId: this.replyMessageId, requesterId: this.target.requesterId, stop: () => this.requestStop(),
      });
    } catch (err) { console.error('[channel:feishu] failed to send reply card', err); }
    this.startHeartbeat();
  }

  onRunStart(stop: () => void): void {
    if (this.finalizing || this.stopping) return;
    this.started = true;
    this.stopControl = stop;
    this.scheduleFlush();
  }

  private requestStop(): boolean {
    if (!this.stopControl || this.finalizing || this.stopping) return false;
    const stop = this.stopControl;
    this.stopControl = undefined;
    this.stopping = true;
    stop();
    this.scheduleFlush();
    return true;
  }

  private replyProgress(): object {
    return buildReplyCard('', this.stopping ? 'stopping' : this.started ? 'working' : 'queued',
      this.target.requesterId ? this.stopToken : undefined);
  }

  private takeCommentary(): string {
    const text = this.accumulated;
    this.accumulated = '';
    return text;
  }

  onText(delta: string): void {
    this.accumulated += delta;
    this.scheduleFlush();
  }

  onToolCall(name: string, args: unknown, toolCallId?: string): void {
    const existing = toolCallId ? this.findTool(toolCallId) : undefined;
    if (existing) {
      existing.id = toolCallId ?? existing.id;
      existing.name = name;
      existing.label = formatToolLabel(name, args);
      existing.inputStreaming = false;
      existing.argsReceived = true;
    } else {
      this.tools.push({
        id: toolCallId,
        name,
        label: formatToolLabel(name, args),
        beforeText: this.takeCommentary(),
        startedAt: Date.now(),
        done: false,
        argsReceived: true,
      });
    }
    this.scheduleFlush();
  }

  onToolResult(result: { name: string; result: string; toolCallId?: string }): void {
    this.markToolDone(result.toolCallId, result.name);
    this.scheduleFlush();
  }

  onToolInputStart(data: { id: string; toolName: string }): void {
    const existing = this.findTool(data.id);
    if (existing) {
      existing.id = data.id;
      existing.name = data.toolName;
      existing.inputStreaming = true;
      if (!existing.argsReceived) existing.label = `${data.toolName} — preparing input`;
    } else {
      this.tools.push({
        id: data.id,
        name: data.toolName,
        label: `${data.toolName} — preparing input`,
        beforeText: this.takeCommentary(),
        startedAt: Date.now(),
        done: false,
        inputBytes: 0,
        inputStreaming: true,
      });
    }
    this.scheduleFlush();
  }

  onToolInputDelta(data: { id: string; delta: string }): void {
    const tool = this.findTool(data.id);
    if (!tool) return;
    tool.inputBytes = (tool.inputBytes ?? 0) + Buffer.byteLength(data.delta, 'utf8');
    tool.inputPreview = ((tool.inputPreview ?? '') + data.delta).slice(0, 8_000);
    if (!tool.argsReceived) {
      tool.label = formatStreamingToolLabel(tool.name, tool.inputPreview)
        ?? `${tool.name} — preparing input ${formatByteCount(tool.inputBytes)}`;
    }
    this.scheduleFlush();
  }

  onToolInputEnd(data: { id: string }): void {
    const tool = this.findTool(data.id);
    if (!tool) return;
    tool.inputStreaming = false;
    if (!tool.argsReceived && !formatStreamingToolLabel(tool.name, tool.inputPreview ?? '')) {
      tool.label = `${tool.name} — prepared input`;
    }
    this.scheduleFlush();
  }

  async onImage(imagePath: string, mimeType?: string): Promise<void> {
    try {
      await sendImageMessage(this.client, this.target, imagePath, mimeType);
      // The image tool's result is consumed by the image relay (no onToolResult
      // for it), so close out its pending entry here.
      this.markToolDone();
      this.scheduleFlush();
    } catch (err) {
      console.error('[channel:feishu] failed to send image', err);
    }
  }

  /**
   * Mark the most recent still-running tool as done (preferring one whose
   * label matches `name`) and record how long it took.
   */
  private findTool(toolCallId?: string, name?: string): ToolRun | undefined {
    if (toolCallId) {
      const byId = this.tools.find((tool) => tool.id === toolCallId);
      if (byId) return byId;
      return undefined;
    }
    if (name) {
      for (let i = this.tools.length - 1; i >= 0; i--) {
        const tool = this.tools[i];
        if (!tool.done && tool.name === name) return tool;
      }
    }
    return undefined;
  }

  private markToolDone(toolCallId?: string, name?: string): void {
    let idx = -1;
    if (toolCallId) {
      idx = this.tools.findIndex((tool) => tool.id === toolCallId && !tool.done);
    }
    for (let i = this.tools.length - 1; i >= 0; i--) {
      if (idx !== -1) break;
      if (this.tools[i].done) continue;
      if (idx === -1) idx = i; // fallback: latest running regardless of name
      if (name && (this.tools[i].name === name || this.tools[i].label.startsWith(name))) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;
    const t = this.tools[idx];
    t.done = true;
    t.elapsedSec = Math.round((Date.now() - t.startedAt) / 1000);
  }

  async onClarification(question: string): Promise<void> {
    // Surface the question as its own text message so it stands out from the
    // streamed card; the user's next message is routed back as the answer.
    try {
      await withTimeout(
        sendTextMessage(this.client, this.target, `❓ ${question}`),
        CARD_SEND_TIMEOUT_MS,
        'Feishu clarification send',
      );
    } catch (err) {
      console.error('[channel:feishu] failed to send clarification', err);
      // Re-throw so the bridge can fail the run: a question the user never
      // received can never be answered, and parking it would pin the scope.
      throw err;
    }
  }

  async onDone(text: string, options?: { stopped?: boolean }): Promise<void> {
    this.cancelTimers();
    // Any tool without an observed result (e.g. the run ended right after)
    // shouldn't linger as ⏳ in the folded list.
    const now = Date.now();
    for (const t of this.tools) {
      if (t.done) continue;
      t.done = true;
      t.elapsedSec = Math.round((now - t.startedAt) / 1000);
    }
    const stopped = options?.stopped === true || this.stopping;
    const answer = text.trim();
    const progress = this.accumulated.trimEnd();
    const commentary = !stopped && answer && progress.endsWith(answer) ? progress.slice(0, -answer.length) : progress;
    await this.finalize(() => buildDoneCard(commentary, this.tools, stopped), stopped ? '已停止。' : text || '已完成', stopped ? 'stopped' : 'completed');
  }

  async onError(message: string): Promise<void> {
    this.cancelTimers();
    await this.finalize(() => buildErrorCard(message), `执行失败：${message}`, 'error');
  }

  private elapsedSec(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }

  private scheduleFlush(): void {
    if (this.finalizing || this.flushTimer) return;
    const wait = Math.max(0, PROGRESS_THROTTLE_MS - (Date.now() - this.lastFlush));
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.lastFlush = Date.now();
      this.enqueueProgress(() => buildProgressCard(this.accumulated, this.tools, this.elapsedSec()));
    }, wait);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.finalizing) return;
      this.lastFlush = Date.now();
      this.enqueueProgress(() => buildProgressCard(this.accumulated, this.tools, this.elapsedSec()));
    }, PROGRESS_HEARTBEAT_MS);
  }

  private cancelTimers(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Keep only the newest progress snapshot while a card patch is in flight.
   * Feishu patch calls can be slow; queuing every 800ms snapshot can leave the
   * final answer stuck behind stale updates for minutes.
   */
  private enqueueProgress(factory: () => object): void {
    if (this.finalizing) return;
    this.pendingProgressFactory = factory;
    this.drainProgressUpdates();
  }

  private drainProgressUpdates(): void {
    if (this.updateInFlight || this.finalizing) return;
    const factory = this.pendingProgressFactory;
    if (!factory) return;

    this.pendingProgressFactory = null;
    const update = Promise.all([this.patchCard(factory, 'Feishu card update'), this.patchReply(this.replyProgress())]).then(results => results.every(Boolean));
    this.updateInFlight = update;
    void update.finally(() => {
      if (this.updateInFlight === update) {
        this.updateInFlight = null;
      }
      this.drainProgressUpdates();
    });
  }

  private async patchCard(factory: () => object, label: string): Promise<boolean> {
    if (this.cardFailed || !this.cardMessageId) return false;
    try {
      await withTimeout(
        this.runCard.update(factory(), this.finalizing),
        CARD_UPDATE_TIMEOUT_MS,
        label,
      );
      return true;
    } catch (err) {
      if (isTimeoutError(err)) {
        this.cardUpdateTimedOut = true;
        this.runCard.abandon();
      }
      // Treat non-timeout patch failures as transient. Feishu can reject an
      // individual update because of rate limits or a stale card state; stopping
      // all later patches makes the bot appear frozen mid-run.
      console.error('[channel:feishu] card update failed', err);
      return false;
    }
  }

  private async patchReply(card: object): Promise<boolean> {
    if (!this.replyMessageId || this.replyTimedOut) return false;
    const snapshot = JSON.stringify(card);
    if (snapshot === this.replySnapshot) return true;
    try {
      await withTimeout(updateCardMessage(this.client, this.replyMessageId, card), CARD_UPDATE_TIMEOUT_MS, 'Feishu reply update');
      this.replySnapshot = snapshot;
      return true;
    } catch (err) {
      if (isTimeoutError(err)) this.replyTimedOut = true;
      console.error('[channel:feishu] reply update failed', err);
      return false;
    }
  }

  private async finalize(factory: () => object, fallbackText: string, status: 'completed' | 'stopped' | 'error'): Promise<void> {
    this.finalizing = true;
    this.stopControl = undefined;
    this.actions.remove(this.stopToken);
    this.pendingProgressFactory = null;
    if (this.updateInFlight) {
      await this.updateInFlight;
    }

    // Legacy message patches have no ordering guarantee. CardKit can safely
    // supersede a timed-out request with a newer sequence and close loading.
    const [, replyUpdated] = await Promise.all([
      this.cardUpdateTimedOut && !this.runCard.hasOrderedUpdates ? false : this.patchCard(factory, 'Feishu final card update'),
      this.patchReply(buildReplyCard(fallbackText, status)),
    ]);
    if (!replyUpdated) {
      await this.sendFallbackText(fallbackText);
    }
  }

  private async sendFallbackText(text: string): Promise<void> {
    try {
      await withTimeout(
        sendTextMessage(this.client, this.target, text),
        CARD_SEND_TIMEOUT_MS,
        'Feishu fallback text send',
      );
    } catch (err) {
      console.error('[channel:feishu] fallback text send failed', err);
    }
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label + ' timed out after ' + ms + 'ms')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof TimeoutError || (err instanceof Error && err.name === 'TimeoutError');
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
