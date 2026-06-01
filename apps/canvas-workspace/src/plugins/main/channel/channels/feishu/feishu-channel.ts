import * as lark from '@larksuiteoapi/node-sdk';
import type {
  Channel,
  ChannelStream,
  InboundHandler,
  InboundMessage,
  OutboundTarget,
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
  formatToolHint,
} from './card';

const CHANNEL_ID = 'feishu';
const PROGRESS_THROTTLE_MS = 800;

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

  async openStream(target: OutboundTarget): Promise<ChannelStream> {
    if (!this.client) throw new Error('Feishu channel not started');
    const stream = new FeishuStream(this.client, toSendTarget(target));
    await stream.init();
    return stream;
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
class FeishuStream implements ChannelStream {
  private cardMessageId: string | null = null;
  private cardFailed = false;
  private accumulated = '';
  private toolHint: string | undefined;
  private readonly startedAt = Date.now();

  private updateChain: Promise<void> = Promise.resolve();
  private flushTimer: NodeJS.Timeout | null = null;
  private lastFlush = 0;

  constructor(
    private readonly client: lark.Client,
    private readonly target: FeishuSendTarget,
  ) {}

  async init(): Promise<void> {
    try {
      this.cardMessageId = await sendCardMessage(this.client, this.target, buildThinkingCard());
    } catch (err) {
      // If the initial card cannot be sent, fall back to text messages.
      this.cardFailed = true;
      console.error('[channel:feishu] failed to send thinking card', err);
    }
  }

  onText(delta: string): void {
    this.accumulated += delta;
    this.scheduleFlush();
  }

  onToolCall(name: string, args: unknown): void {
    this.toolHint = formatToolHint(name, args);
    this.scheduleFlush();
  }

  async onImage(imagePath: string, mimeType?: string): Promise<void> {
    try {
      await sendImageMessage(this.client, this.target, imagePath, mimeType);
      this.toolHint = '🖼️ Image sent';
      this.scheduleFlush();
    } catch (err) {
      console.error('[channel:feishu] failed to send image', err);
    }
  }

  async onClarification(question: string): Promise<void> {
    // Surface the question as its own text message so it stands out from the
    // streamed card; the user's next message is routed back as the answer.
    try {
      await sendTextMessage(this.client, this.target, `❓ ${question}`);
    } catch (err) {
      console.error('[channel:feishu] failed to send clarification', err);
    }
  }

  async onDone(text: string): Promise<void> {
    this.cancelFlush();
    await this.finalize(() => buildDoneCard(text), text);
  }

  async onError(message: string): Promise<void> {
    this.cancelFlush();
    await this.finalize(() => buildErrorCard(message), `❌ Error: ${message}`);
  }

  private elapsedSec(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }

  private scheduleFlush(): void {
    if (this.cardFailed || this.flushTimer) return;
    const wait = Math.max(0, PROGRESS_THROTTLE_MS - (Date.now() - this.lastFlush));
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.lastFlush = Date.now();
      this.enqueue(() => buildProgressCard(this.accumulated, this.toolHint, this.elapsedSec()));
    }, wait);
  }

  private cancelFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Serialize card patches so concurrent updates cannot race. */
  private enqueue(factory: () => object): Promise<void> {
    this.updateChain = this.updateChain.then(async () => {
      if (this.cardFailed || !this.cardMessageId) return;
      try {
        await updateCardMessage(this.client, this.cardMessageId, factory());
      } catch (err) {
        this.cardFailed = true;
        console.error('[channel:feishu] card update failed', err);
      }
    });
    return this.updateChain;
  }

  private async finalize(factory: () => object, fallbackText: string): Promise<void> {
    await this.enqueue(factory);
    // If the card pathway failed at any point, deliver the result as text so
    // the user still sees the final answer.
    if (this.cardFailed) {
      try {
        await sendTextMessage(this.client, this.target, fallbackText);
      } catch (err) {
        console.error('[channel:feishu] fallback text send failed', err);
      }
    }
  }
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

/** Normalize a Feishu im.message.receive_v1 payload, or null to ignore it. */
export function parseInbound(data: unknown): InboundMessage | null {
  const event = data as FeishuMessageEvent;
  const message = event?.message;
  if (!message || message.message_type !== 'text') return null;

  const messageId = message.message_id ?? '';
  const chatId = message.chat_id ?? '';
  const threadId = message.thread_id?.trim() || undefined;
  const rootId = message.root_id?.trim() || undefined;
  const userId = event.sender?.sender_id?.open_id ?? '';
  if (!chatId) return null;

  let text = '';
  try {
    const content = JSON.parse(message.content ?? '{}') as { text?: string };
    text = content.text?.trim() ?? '';
  } catch {
    return null;
  }

  const isGroup = message.chat_type === 'group';
  const mentions = (message.mentions as unknown[] | undefined) ?? [];
  if (isGroup) {
    // In group chats (incl. topic groups), only respond when @-mentioned.
    if (mentions.length === 0) return null;
    text = text.replace(/@\S+/g, '').trim();
  }

  if (!text) return null;

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
    text,
    isMention: isGroup && mentions.length > 0,
    isDirect: !isGroup,
    reply,
  };
}
