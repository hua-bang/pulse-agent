import * as lark from '@larksuiteoapi/node-sdk';
import type {
  Channel,
  ChannelStream,
  InboundHandler,
  InboundMessage,
  OutboundTarget,
  WorkspacePicker,
} from '../../core/types';
import {
  createLarkClient,
  feishuConfigured,
  sendCardMessage,
  sendImageMessage,
  sendTextMessage,
  updateCardMessage,
  type FeishuSendTarget,
} from './feishu-client';
import {
  buildDoneCard,
  buildErrorCard,
  buildProgressCard,
  buildThinkingCard,
  buildWorkspacePickerCard,
  formatToolLabel,
  WORKSPACE_PICKER_SELECT_NAME,
} from './card';

const CHANNEL_ID = 'feishu';
const PROGRESS_THROTTLE_MS = 800;
const PROGRESS_HEARTBEAT_MS = 15_000;
const CARD_SEND_TIMEOUT_MS = 10_000;
const CARD_UPDATE_TIMEOUT_MS = 10_000;

/**
 * Feishu channel using the SDK's long-connection (WSClient) event stream —
 * the canvas app dials out to Feishu over a WebSocket, so it works behind
 * NAT with no public webhook URL. Inbound text messages are normalized to
 * {@link InboundMessage}; agent output is rendered into a single interactive
 * card that is progressively patched.
 */
export class FeishuChannel implements Channel {
  readonly id = CHANNEL_ID;
  private wsClient: lark.WSClient | null = null;
  private client: lark.Client | null = null;

  isConfigured(): boolean {
    return feishuConfigured();
  }

  async start(onInbound: InboundHandler): Promise<void> {
    this.client = createLarkClient();
    const appId = process.env.FEISHU_APP_ID!;
    const appSecret = process.env.FEISHU_APP_SECRET!;
    this.wsClient = new lark.WSClient({ appId, appSecret, domain: lark.Domain.Feishu });

    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        if (process.env.CANVAS_CHANNEL_DEBUG) {
          try {
            console.log('[channel:feishu] raw event', JSON.stringify(data));
          } catch {
            /* ignore serialization issues */
          }
        }
        const msg = parseInbound(data);
        if (msg) onInbound(msg);
      },
      'card.action.trigger': async (data: unknown) => {
        logRawCardAction(data);
        const msg = parseCardAction(data);
        if (msg) onInbound(msg);
        return {};
      },
      'interactive_card.action.trigger': async (data: unknown) => {
        logRawCardAction(data);
        const msg = parseCardAction(data);
        if (msg) onInbound(msg);
        return {};
      },
    });

    this.wsClient.start({ eventDispatcher });
  }

  async stop(): Promise<void> {
    // WSClient teardown varies across SDK versions; call stop() if present.
    const ws = this.wsClient as unknown as { stop?: () => void } | null;
    try {
      ws?.stop?.();
    } catch (err) {
      console.error('[channel:feishu] WSClient stop failed', err);
    }
    this.wsClient = null;
    this.client = null;
  }

  async sendText(target: OutboundTarget, text: string): Promise<void> {
    if (!this.client) throw new Error('Feishu channel not started');
    await sendTextMessage(this.client, toSendTarget(target), text);
  }

  async sendWorkspacePicker(target: OutboundTarget, picker: WorkspacePicker): Promise<void> {
    if (!this.client) throw new Error('Feishu channel not started');
    try {
      await sendCardMessage(this.client, toSendTarget(target), buildWorkspacePickerCard(picker, target));
    } catch (err) {
      console.error('[channel:feishu] failed to send workspace picker card', err);
      await sendTextMessage(this.client, toSendTarget(target), picker.fallbackText);
    }
  }

  async openStream(target: OutboundTarget): Promise<ChannelStream> {
    if (!this.client) throw new Error('Feishu channel not started');
    const stream = new FeishuStream(this.client, toSendTarget(target));
    await stream.init();
    return stream;
  }
}

function logRawCardAction(data: unknown): void {
  if (!process.env.CANVAS_CHANNEL_DEBUG) return;
  try {
    console.log('[channel:feishu] raw card action', JSON.stringify(data));
  } catch {
    /* ignore serialization issues */
  }
}

/** Recover the channel-specific reply routing from an OutboundTarget. */
function toSendTarget(target: OutboundTarget): FeishuSendTarget {
  const reply = target.reply as Partial<FeishuSendTarget> | undefined;
  if (reply?.chatId) {
    return {
      chatId: reply.chatId,
      threadId: reply.threadId,
      isGroup: Boolean(reply.isGroup),
      triggerMessageId: reply.triggerMessageId ?? '',
    };
  }
  // Fallback: treat the conversation id as a bare chat_id (no threading).
  return { chatId: target.conversationId, isGroup: false, triggerMessageId: '' };
}

/**
 * Renders one agent run into a single Feishu card. Text/tool events are
 * accumulated and flushed to the card on a trailing throttle so we don't
 * exceed Feishu's update-rate limits; images are sent as separate messages.
 */
interface ToolRun {
  id?: string;
  name: string;
  label: string;
  startedAt: number;
  done: boolean;
  elapsedSec?: number;
  inputBytes?: number;
  inputStreaming?: boolean;
  argsReceived?: boolean;
}

export class FeishuStream implements ChannelStream {
  private cardMessageId: string | null = null;
  private cardFailed = false;
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
  ) {}

  async init(): Promise<void> {
    try {
      this.cardMessageId = await withTimeout(
        sendCardMessage(this.client, this.target, buildThinkingCard()),
        CARD_SEND_TIMEOUT_MS,
        'Feishu thinking card send',
      );
    } catch (err) {
      // If the initial card cannot be sent, fall back to text messages.
      this.cardFailed = true;
      console.error('[channel:feishu] failed to send thinking card', err);
      return;
    }
    this.startHeartbeat();
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
    tool.inputBytes = (tool.inputBytes ?? 0) + data.delta.length;
    if (!tool.argsReceived) {
      tool.label = `${tool.name} — preparing input ${formatByteCount(tool.inputBytes)}`;
    }
    this.scheduleFlush();
  }

  onToolInputEnd(data: { id: string }): void {
    const tool = this.findTool(data.id);
    if (!tool) return;
    tool.inputStreaming = false;
    if (!tool.argsReceived) {
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
    }
  }

  async onDone(text: string): Promise<void> {
    this.cancelTimers();
    // Any tool without an observed result (e.g. the run ended right after)
    // shouldn't linger as ⏳ in the folded list.
    const now = Date.now();
    for (const t of this.tools) {
      if (t.done) continue;
      t.done = true;
      t.elapsedSec = Math.round((now - t.startedAt) / 1000);
    }
    await this.finalize(() => buildDoneCard(text, this.tools), text);
  }

  async onError(message: string): Promise<void> {
    this.cancelTimers();
    await this.finalize(() => buildErrorCard(message), `❌ Error: ${message}`);
  }

  private elapsedSec(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }

  private scheduleFlush(): void {
    if (this.cardFailed || this.finalizing || this.flushTimer) return;
    const wait = Math.max(0, PROGRESS_THROTTLE_MS - (Date.now() - this.lastFlush));
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.lastFlush = Date.now();
      this.enqueueProgress(() => buildProgressCard(this.accumulated, this.tools, this.elapsedSec()));
    }, wait);
  }

  private startHeartbeat(): void {
    if (this.cardFailed || this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.cardFailed || this.finalizing) return;
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
    if (this.cardFailed || this.finalizing) return;
    this.pendingProgressFactory = factory;
    this.drainProgressUpdates();
  }

  private drainProgressUpdates(): void {
    if (this.updateInFlight || this.cardFailed || this.finalizing) return;
    const factory = this.pendingProgressFactory;
    if (!factory) return;

    this.pendingProgressFactory = null;
    const update = this.patchCard(factory, 'Feishu card update');
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
        updateCardMessage(this.client, this.cardMessageId, factory()),
        CARD_UPDATE_TIMEOUT_MS,
        label,
      );
      return true;
    } catch (err) {
      if (isTimeoutError(err)) this.cardUpdateTimedOut = true;
      // Treat non-timeout patch failures as transient. Feishu can reject an
      // individual update because of rate limits or a stale card state; stopping
      // all later patches makes the bot appear frozen mid-run.
      console.error('[channel:feishu] card update failed', err);
      return false;
    }
  }

  private async finalize(factory: () => object, fallbackText: string): Promise<void> {
    this.finalizing = true;
    this.pendingProgressFactory = null;
    if (this.updateInFlight) {
      await this.updateInFlight;
    }

    // A timed-out card patch may still complete later and overwrite newer card
    // content. Once that happens, stop trusting this card and send the final
    // answer as a separate text message instead of racing another patch.
    const finalUpdated = this.cardUpdateTimedOut
      ? false
      : await this.patchCard(factory, 'Feishu final card update');
    if (!finalUpdated) {
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

// ── Event parsing ───────────────────────────────────────────────────────────

interface FeishuMessageEvent {
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
    mentions?: unknown[];
    /** Present in topic groups (话题群) — identifies the topic/thread. */
    thread_id?: string;
    /** Root message of the thread/topic, when applicable. */
    root_id?: string;
    parent_id?: string;
  };
  sender?: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string };
  };
}

function asMentionList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionString(mention: unknown, key: 'key' | 'name'): string | null {
  if (!mention || typeof mention !== 'object') return null;
  const value = (mention as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasMentionMarker(text: string): boolean {
  // Feishu text events normally include `mentions`, but topic groups can omit
  // it while still leaving a visible/textual at-marker in content.
  return /<at\b/i.test(text) || /(^|\s)@\S+/.test(text);
}

function stripMentionText(text: string, mentions: unknown[]): string {
  let out = text;
  for (const mention of mentions) {
    for (const key of ['key', 'name'] as const) {
      const value = mentionString(mention, key);
      if (value) out = out.replace(new RegExp(escapeRegExp(value), 'g'), '');
    }
  }
  return out
    .replace(/<at\b[^>]*>.*?<\/at>/gi, '')
    .replace(/(^|\s)@\S+/g, ' ')
    .replace(/(^|\s)@(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectPostText(node: unknown, out: string[]): void {
  if (!node) return;
  if (typeof node === 'string') {
    if (node.trim()) out.push(node.trim());
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectPostText(item, out);
    return;
  }
  if (typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  const tag = typeof record.tag === 'string' ? record.tag : '';
  if (tag === 'at') {
    const userName = typeof record.user_name === 'string' ? record.user_name.trim() : '';
    out.push(userName ? `@${userName}` : '@');
    return;
  }
  if (typeof record.text === 'string' && record.text.trim()) {
    out.push(record.text.trim());
  }
  for (const key of ['content', 'elements', 'children']) {
    collectPostText(record[key], out);
  }
}

function extractMessageText(rawContent: string | undefined, messageType: string | undefined): string | null {
  try {
    const content = JSON.parse(rawContent ?? '{}') as Record<string, unknown>;
    if (messageType === 'text') {
      return typeof content.text === 'string' ? content.text.trim() : '';
    }
    if (messageType === 'post') {
      const parts: string[] = [];
      collectPostText(content, parts);
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }
    return null;
  } catch {
    return null;
  }
}

interface FeishuCardActionEvent {
  open_id?: string;
  user_id?: string;
  open_message_id?: string;
  message_id?: string;
  operator?: {
    open_id?: string;
    user_id?: string;
    operator_id?: {
      open_id?: string;
      user_id?: string;
    };
  };
  context?: {
    open_message_id?: string;
    message_id?: string;
  };
  event?: FeishuCardActionEvent;
  action?: {
    value?: Record<string, unknown>;
    form_value?: Record<string, unknown>;
    behaviors?: Array<{ value?: Record<string, unknown> }>;
  };
}

/** Normalize a Feishu im.message.receive_v1 payload, or null to ignore it. */
export function parseInbound(data: unknown): InboundMessage | null {
  const event = data as FeishuMessageEvent;
  const message = event?.message;
  if (!message || !['text', 'post'].includes(message.message_type ?? '')) return null;

  const messageId = message.message_id ?? '';
  const chatId = message.chat_id ?? '';
  const threadId = message.thread_id?.trim() || undefined;
  const rootId = message.root_id?.trim() || undefined;
  const userId = event.sender?.sender_id?.open_id ?? '';
  if (!chatId) return null;

  const text = extractMessageText(message.content, message.message_type);
  if (text === null) return null;

  const isGroup = message.chat_type === 'group' || message.chat_type === 'topic_group';
  const mentions = asMentionList(message.mentions);
  let cleanText = text;
  if (isGroup) {
    // In group chats (incl. topic groups), only respond when @-mentioned.
    if (mentions.length === 0 && !hasMentionMarker(cleanText)) return null;
    cleanText = stripMentionText(cleanText, mentions);
  }

  if (!cleanText) return null;

  // Each topic in a topic group is its own conversation — and thus its own
  // session. A threaded message carries thread_id (the topic) and/or root_id
  // (the topic's first message); we key on thread_id, falling back to root_id
  // so a topic's root and its replies stay one conversation even if Feishu
  // omits thread_id on the root. Plain groups (neither) key on chat_id alone,
  // so a DM, each group, and each topic are independent.
  const topicKey = threadId ?? rootId;
  const conversationId = topicKey ? `${chatId}:${topicKey}` : chatId;

  const reply: FeishuSendTarget = {
    chatId,
    threadId: topicKey,
    isGroup,
    triggerMessageId: messageId,
  };

  if (process.env.CANVAS_CHANNEL_DEBUG) {
    console.log(
      `[channel:feishu] inbound chat_type=${message.chat_type} thread_id=${message.thread_id ?? '-'} ` +
        `root_id=${message.root_id ?? '-'} conv=${conversationId}`,
    );
  }

  return {
    channelId: CHANNEL_ID,
    conversationId,
    userId,
    messageId,
    text: cleanText,
    isMention: isGroup && mentions.length > 0,
    isDirect: !isGroup,
    reply,
  };
}

function isFeishuSendTarget(value: unknown): value is FeishuSendTarget {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<FeishuSendTarget>;
  return typeof record.chatId === 'string' && typeof record.isGroup === 'boolean';
}

/** Normalize a Feishu interactive-card action into an internal slash command. */
export function parseCardAction(data: unknown): InboundMessage | null {
  const event = unwrapCardActionEvent(data);
  const value = cardActionValue(event);
  if (!value || value.action !== 'workspace.use') {
    debugCardActionIgnored('missing workspace.use action', data);
    return null;
  }

  const formValue = event.action?.form_value;
  const selectedWorkspaceId =
    typeof formValue?.[WORKSPACE_PICKER_SELECT_NAME] === 'string'
      ? formValue[WORKSPACE_PICKER_SELECT_NAME].trim()
      : '';
  const workspaceId = typeof value.workspaceId === 'string'
    ? value.workspaceId.trim()
    : selectedWorkspaceId;
  const conversationId = typeof value.conversationId === 'string' ? value.conversationId : '';
  const reply = isFeishuSendTarget(value.reply) ? value.reply : null;
  if (!workspaceId || !conversationId || !reply) {
    debugCardActionIgnored('missing workspace id, conversation id, or reply target', data);
    return null;
  }

  const carry = value.carry === true;
  const cardMessageId =
    event.open_message_id ??
    event.message_id ??
    event.context?.open_message_id ??
    event.context?.message_id ??
    'unknown';
  const userId =
    event.open_id ??
    event.user_id ??
    event.operator?.open_id ??
    event.operator?.user_id ??
    event.operator?.operator_id?.open_id ??
    event.operator?.operator_id?.user_id ??
    '';
  const messageId = `card:${cardMessageId}:${userId}:${conversationId}:${workspaceId}:${carry ? 'carry' : 'use'}`;
  return {
    channelId: CHANNEL_ID,
    conversationId,
    userId,
    messageId,
    text: `/use ${workspaceId}${carry ? ' --carry' : ''}`,
    isMention: reply.isGroup,
    isDirect: !reply.isGroup,
    reply,
  };
}

function debugCardActionIgnored(reason: string, data: unknown): void {
  if (!process.env.CANVAS_CHANNEL_DEBUG) return;
  try {
    console.warn('[channel:feishu] ignored card action:', reason, JSON.stringify(data));
  } catch {
    console.warn('[channel:feishu] ignored card action:', reason);
  }
}

function unwrapCardActionEvent(data: unknown): FeishuCardActionEvent {
  const event = data as FeishuCardActionEvent;
  return event.event ?? event;
}

function cardActionValue(event: FeishuCardActionEvent): Record<string, unknown> | null {
  const direct = event.action?.value;
  if (direct && typeof direct === 'object') return direct;
  const behaviorValue = event.action?.behaviors?.find((behavior) => behavior.value)?.value;
  return behaviorValue && typeof behaviorValue === 'object' ? behaviorValue : null;
}
