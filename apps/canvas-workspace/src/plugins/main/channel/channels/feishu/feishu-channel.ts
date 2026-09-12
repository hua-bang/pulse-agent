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
  sendTextMessage,
  type FeishuSendTarget,
} from './feishu-client';
import {
  buildWorkspacePickerCard,
  WORKSPACE_PICKER_SELECT_NAME,
} from './card';
import { downloadInboundImages, extractInboundImageKeys } from './inbound-image';
import { loadBotIdentity, messageMentionsBot, type FeishuBotIdentity } from './bot-mention';

import { FeishuStream } from './feishu-stream';
import { FeishuRunActions } from './run-actions';
const CHANNEL_ID = 'feishu';
export { FeishuStream } from './feishu-stream';

/**
 * Feishu channel using the SDK's long-connection (WSClient) event stream —
 * the canvas app dials out to Feishu over a WebSocket, so it works behind
 * NAT with no public webhook URL. Inbound text messages are normalized to
 * {@link InboundMessage}; agent output is rendered into a streamed process
 * card and a separate response card with turn-scoped controls.
 */
export class FeishuChannel implements Channel {
  readonly id = CHANNEL_ID;
  private readonly runActions = new FeishuRunActions();
  private wsClient: lark.WSClient | null = null;
  private client: lark.Client | null = null;

  isConfigured(): boolean {
    return feishuConfigured();
  }

  async start(onInbound: InboundHandler): Promise<void> {
    this.client = createLarkClient();
    const appId = process.env.FEISHU_APP_ID!;
    const appSecret = process.env.FEISHU_APP_SECRET!;
    const botIdentity = await loadBotIdentity(appId);
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
        const msg = parseInbound(data, botIdentity);
        if (!msg) return;
        // Download any attached images to local temp files so the agent can
        // read them with a vision tool. Best-effort: failures are logged.
        const imageKeys = extractInboundImageKeys(data);
        if (imageKeys.length > 0) {
          msg.imagePaths = await downloadInboundImages(msg.messageId, imageKeys);
        }
        onInbound(msg);
      },
      'card.action.trigger': async (data: unknown) => {
        logRawCardAction(data);
        const control = this.runActions.handle(data);
        if (control) return control;
        const msg = parseCardAction(data);
        if (msg) onInbound(msg);
        return {};
      },
      'interactive_card.action.trigger': async (data: unknown) => {
        logRawCardAction(data);
        const control = this.runActions.handle(data);
        if (control) return control;
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
    this.runActions.clear();
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
    const stream = new FeishuStream(this.client, toSendTarget(target), this.runActions);
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
      requesterId: reply.requesterId,
      threadId: reply.threadId,
      isGroup: Boolean(reply.isGroup),
      triggerMessageId: reply.triggerMessageId ?? '',
    };
  }
  // Fallback: treat the conversation id as a bare chat_id (no threading).
  return { chatId: target.conversationId, isGroup: false, triggerMessageId: '' };
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

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

function mentionString(mention: unknown, key: 'key' | 'name'): string | null {
  if (!mention || typeof mention !== 'object') return null;
  const value = (mention as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
    const attrs = ['open_id', 'user_id', 'union_id']
      .map((key) => {
        const value = record[key];
        return typeof value === 'string' && value.trim()
          ? `${key}="${escapeHtmlAttr(value.trim())}"`
          : null;
      })
      .filter((value): value is string => Boolean(value));
    if (attrs.length > 0) {
      out.push(`<at ${attrs.join(' ')}>${escapeHtmlText(userName)}</at>`);
    } else {
      out.push(userName ? `@${userName}` : '@');
    }
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

export interface FeishuCardActionEvent {
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
export function parseInbound(data: unknown, botIdentity?: FeishuBotIdentity): InboundMessage | null {
  const event = data as FeishuMessageEvent;
  const message = event?.message;
  if (!message || !['text', 'post', 'image'].includes(message.message_type ?? '')) return null;

  const messageId = message.message_id ?? '';
  const chatId = message.chat_id ?? '';
  const threadId = message.thread_id?.trim() || undefined;
  const rootId = message.root_id?.trim() || undefined;
  const userId = event.sender?.sender_id?.open_id ?? '';
  if (!chatId) return null;

  // Image messages carry no text body; post/text messages may still embed
  // images, so attachments are tracked separately from the text.
  const imageKeys = extractInboundImageKeys(data);
  const text = message.message_type === 'image'
    ? ''
    : extractMessageText(message.content, message.message_type);
  if (text === null) return null;

  const isGroup = message.chat_type === 'group' || message.chat_type === 'topic_group';
  const mentions = asMentionList(message.mentions);
  let cleanText = text;
  let isBotMention = false;
  if (isGroup) {
    // In group chats (incl. topic groups), only respond when this bot is @-mentioned.
    isBotMention = messageMentionsBot(mentions, cleanText, botIdentity);
    if (!isBotMention) return null;
    cleanText = stripMentionText(cleanText, mentions);
  }

  // Keep the message if it has text OR attached images (an image-only DM is
  // valid). A group message still has to clear the @-mention gate above.
  if (!cleanText && imageKeys.length === 0) return null;

  // Each topic in a topic group is its own conversation — and thus its own
  // session. A threaded message carries thread_id (the topic) and/or root_id
  // (the topic's first message); we key on thread_id, falling back to root_id
  // so a topic's root and its replies stay one conversation even if Feishu
  // omits thread_id on the root. Plain groups (neither) key on chat_id alone,
  // so a DM, each group, and each topic are independent.
  const topicKey = threadId ?? rootId;
  const conversationId = topicKey ? `${chatId}:${topicKey}` : chatId;

  const reply: FeishuSendTarget = {
    requesterId: userId,
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
    isMention: isBotMention,
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
