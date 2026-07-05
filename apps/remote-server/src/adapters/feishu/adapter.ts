import type { HonoRequest, Context as HonoContext } from 'hono';
import { existsSync } from 'fs';
import type { PlatformAdapter, IncomingMessage, StreamHandle } from '../../core/types.js';
import type { ClarificationRequest } from '../../core/types.js';
import { clarificationQueue } from '../../core/clarification-queue.js';
import { getActiveRun, getActiveStreamId } from '../../core/active-run-store.js';
import { dispatchIncoming } from '../../core/dispatcher.js';
import { processIncomingCommand } from '../../core/chat-commands.js';
import type { CommandResult } from '../../core/chat-commands/types.js';
import { extractGeneratedImageResult } from './image-result.js';
import {
  createLarkClient,
  addMessageReaction,
  sendTextMessage,
  sendImageMessage,
  sendCardMessage,
  updateCardMessage,
  buildThinkingCard,
  buildProgressCard,
  buildDoneCard,
  buildErrorCard,
} from './client.js';
import { buildFeishuPlatformKey, parseFeishuPlatformKey, resolveFeishuTopicId } from './platform-key.js';
import { parseFeishuMessageContent } from './message-content.js';
import { isFeishuMessageMentioningCurrentBot } from './mention-filter.js';


/**
 * Feishu (Lark) adapter.
 *
 * Uses the SDK client for sending messages (token refresh, retries).
 * Event routing is handled manually by parsing the JSON body directly —
 * the SDK's EventDispatcher.invoke() bridge was unreliable in Hono context
 * ("no undefined handle" — event_type not extractable via the bridge).
 */

export class FeishuAdapter implements PlatformAdapter {
  name = 'feishu';

  // SDK Client — handles token refresh, retries, domain routing
  private larkClient = createLarkClient();

  // Map from stream/message id -> message target metadata.
  // Set during parseIncoming, read in createStreamHandle.
  private chatMetaByStreamId = new Map<string, FeishuChatMeta>();

  // Fallback map for payloads without message_id.
  // Set during parseIncoming, read in createStreamHandle
  private chatMetaByPlatformKey = new Map<string, FeishuChatMeta>();

  // Dedup cache — prevent processing the same message_id twice
  private seenMessageIds = new Set<string>();

  verifyRequest(_req: HonoRequest): boolean {
    return true;
  }

  async parseIncoming(req: HonoRequest): Promise<IncomingMessage | null> {
    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return null;
    }

    return this.parseEventBody(body);
  }

  async handleCardActionBody(body: Record<string, unknown>): Promise<boolean> {
    const action = parseRunCardAction(body);
    if (!action) return false;

    const text = textForRunCardAction(action);
    if (!text) return true;

    if (action.command === 'runId') {
      await this.sendCardActionText(action, text);
      return true;
    }

    const incoming: IncomingMessage = {
      platformKey: action.platformKey,
      memoryKey: action.memoryKey,
      text,
      streamId: action.syntheticStreamId,
    };

    this.chatMetaByPlatformKey.set(action.platformKey, {
      chatId: action.replyTarget.chatId,
      chatIdType: action.replyTarget.chatIdType,
      allowReaction: false,
    });

    if (action.command === 'retry') {
      dispatchIncoming(this, incoming);
      return true;
    }

    const result = await processIncomingCommand(incoming);
    await this.sendCardActionResult(action, result);
    return true;
  }

  private async sendCardActionText(action: RunCardAction, text: string): Promise<void> {
    const target = action.replyTarget;
    await sendTextMessage(
      this.larkClient,
      target.chatId,
      target.chatIdType,
      text,
    ).catch((err) => {
      console.error('[feishu] Failed to send card action text:', getErrorMessage(err));
    });
  }

  private async sendCardActionResult(action: RunCardAction, result: CommandResult): Promise<void> {
    if (result.type !== 'handled') {
      return;
    }

    const target = action.replyTarget;
    await sendTextMessage(
      this.larkClient,
      target.chatId,
      target.chatIdType,
      result.message,
    ).catch((err) => {
      console.error('[feishu] Failed to send card action result:', getErrorMessage(err));
    });
  }

  async parseEventBody(body: Record<string, unknown>): Promise<IncomingMessage | null> {
    // URL verification
    if (body['type'] === 'url_verification') {
      this.pendingChallenge = body['challenge'] as string;
      return null;
    }

    // Extract event. Webhook payloads wrap it in `event`; SDK long-connection
    // handlers receive the event object directly after EventDispatcher parsing.
    const event = extractFeishuEvent(body);
    if (!event) return null;

    const message = event['message'] as Record<string, unknown> | undefined;
    const sender = event['sender'] as Record<string, unknown> | undefined;
    if (!message || !sender) return null;

    // Dedup by message_id
    const messageId = message['message_id'] as string | undefined;
    if (messageId) {
      if (this.seenMessageIds.has(messageId)) return null;
      this.seenMessageIds.add(messageId);
      if (this.seenMessageIds.size > 500) {
        this.seenMessageIds.delete(this.seenMessageIds.values().next().value!);
      }
    }

    const openId = (sender['sender_id'] as Record<string, unknown> | undefined)?.['open_id'] as string | undefined;
    if (!openId) return null;
    const messageType = asNonEmptyString(message['message_type']);
    const parsedContent = parseFeishuMessageContent(messageType, message['content'], messageId);
    if (!parsedContent) return null;

    let text = parsedContent.text;
    const attachments = parsedContent.attachments;
    const hasAttachments = attachments.length > 0;
    if (!text && !hasAttachments) return null;

    const chatId = message['chat_id'] as string | undefined;
    const chatType = message['chat_type'] as string | undefined; // 'p2p' | 'group'
    const isGroupChat = chatType === 'group';

    // Group chats: only respond when this bot is @mentioned.
    if (isGroupChat) {
      const mentions = (message['mentions'] as unknown[] | undefined) ?? [];
      if (!await isFeishuMessageMentioningCurrentBot(mentions)) return null;
      text = removeFeishuMentions(text, mentions);
      if (!text && !hasAttachments) return null;
    }

    const topicId = isGroupChat ? resolveFeishuTopicId(message) : undefined;
    const platformKey = buildFeishuPlatformKey({
      chatId,
      chatType,
      openId,
      topicId,
    });
    const memoryKey = `feishu:user:${openId}`;

    if (messageId && shouldAddFeishuReactions(isGroupChat)) {
      // Best-effort acknowledgement reaction for accepted user messages.
      addMessageReaction(messageId, 'Get').catch((err) => {
        console.warn('[feishu] Failed to add Get reaction:', getErrorMessage(err));
      });
    }

    const meta = resolveFeishuChatMeta({
      chatId,
      chatType,
      openId,
      sourceMessageId: messageId,
      topicId,
    });
    const chatMeta = {
      ...meta,
      allowReaction: shouldAddFeishuReactions(isGroupChat),
    };
    this.chatMetaByPlatformKey.set(platformKey, chatMeta);
    if (messageId) {
      this.chatMetaByStreamId.set(messageId, chatMeta);
      pruneMap(this.chatMetaByStreamId, 500);
    }

    // Route to pending clarification if one is waiting
    const activeStreamId = getActiveStreamId(platformKey);
    if (activeStreamId && clarificationQueue.hasPending(activeStreamId)) {
      const pending = clarificationQueue.getPending(activeStreamId);
      if (pending) {
        clarificationQueue.submitAnswer(activeStreamId, pending.request.id, text);
        await sendTextMessage(
          this.larkClient,
          meta.chatId,
          meta.chatIdType,
          `✅ Got it: "${text}"`,
          meta.chatIdType === 'chat_id' && messageId ? { replyToMessageId: messageId } : undefined,
        ).catch((err) => {
          console.error('[feishu] Failed to send clarification ack:', getErrorMessage(err));
        });
      }
      return null;
    }

    return { platformKey, memoryKey, text, attachments: hasAttachments ? attachments : undefined, streamId: messageId };
  }

  // URL verification challenge to return in ackRequest
  private pendingChallenge: string | null = null;

  ackRequest(c: HonoContext, _incoming: IncomingMessage | null): Response {
    if (this.pendingChallenge) {
      const challenge = this.pendingChallenge;
      this.pendingChallenge = null;
      return c.json({ challenge }, 200);
    }
    return c.json({}, 200);
  }

  async createStreamHandle(incoming: IncomingMessage, _streamId: string): Promise<StreamHandle> {
    const meta = this.chatMetaByStreamId.get(_streamId)
      ?? (incoming.streamId ? this.chatMetaByStreamId.get(incoming.streamId) : undefined)
      ?? this.chatMetaByPlatformKey.get(incoming.platformKey);
    const fallbackMeta = meta ?? resolveFeishuChatMetaFromPlatformKey(incoming.platformKey);
    const chatId = fallbackMeta.chatId;
    const idType = fallbackMeta.chatIdType;
    const sourceMessageId = fallbackMeta.sourceMessageId;
    const allowReaction = fallbackMeta.allowReaction ?? false;
    const replyOptions = idType === 'chat_id' && sourceMessageId ? { replyToMessageId: sourceMessageId } : undefined;
    const { larkClient } = this;
    const activeRun = getActiveRun(incoming.platformKey);

    // Clean up chatMeta after reading — it's only needed to bridge parseIncoming → createStreamHandle
    this.chatMetaByStreamId.delete(_streamId);
    if (incoming.streamId && incoming.streamId !== _streamId) {
      this.chatMetaByStreamId.delete(incoming.streamId);
    }
    if (meta && this.chatMetaByPlatformKey.get(incoming.platformKey) === meta) {
      this.chatMetaByPlatformKey.delete(incoming.platformKey);
    }

    let cardMessageId: string | null = null;
    let accumulatedText = '';
    let latestToolHint = '';
    const toolCallSummaries: string[] = [];

    const PROGRESS_UPDATE_INTERVAL_MS = 800;
    const HEARTBEAT_INTERVAL_MS = 12000;
    const runStartedAt = Date.now();

    let throttleHandle: ReturnType<typeof setTimeout> | null = null;
    let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
    let lastProgressUpdateAt = 0;
    let updateChain: Promise<void> = Promise.resolve();
    let finalized = false;
    let consecutiveCardUpdateFailures = 0;

    const MAX_CONSECUTIVE_CARD_UPDATE_FAILURES = 3;

    const isCardUpdateDisabled = (): boolean => consecutiveCardUpdateFailures >= MAX_CONSECUTIVE_CARD_UPDATE_FAILURES;

    const recordCardUpdateFailure = (reason: string, err: unknown) => {
      if (!cardMessageId || isCardUpdateDisabled()) return;
      consecutiveCardUpdateFailures += 1;
      console.error(
        `[feishu] Card update failed (${reason}) ${consecutiveCardUpdateFailures}/${MAX_CONSECUTIVE_CARD_UPDATE_FAILURES}:`,
        err,
      );
      if (isCardUpdateDisabled()) {
        clearProgressState();
      }
    };

    const tryUpdateCard = async (
      cardFactory: () => object,
      reason: string,
      options?: { allowFinal?: boolean },
    ): Promise<boolean> => {
      if (!cardMessageId || isCardUpdateDisabled()) return false;
      if (finalized && !options?.allowFinal) return false;
      try {
        await updateCardMessage(larkClient, cardMessageId, cardFactory());
        consecutiveCardUpdateFailures = 0;
        return true;
      } catch (err) {
        recordCardUpdateFailure(reason, err);
        return false;
      }
    };

    const queueCardUpdate = (cardFactory: () => object, reason = 'progress') => {
      if (!cardMessageId || finalized || isCardUpdateDisabled()) return;
      updateChain = updateChain.then(async () => {
        if (!cardMessageId || finalized || isCardUpdateDisabled()) return;
        await tryUpdateCard(cardFactory, reason);
      });
    };

    const formatElapsed = (): string => {
      const totalSeconds = Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    };

    const buildRunCardContext = (overrides: Partial<{
      elapsed: string;
      detailText: string;
      latestToolHint: string;
      toolCalls: string[];
    }> = {}) => ({
      platformKey: incoming.platformKey,
      memoryKey: incoming.memoryKey,
      streamId: _streamId,
      runId: activeRun?.runId,
      prompt: incoming.text,
      elapsed: formatElapsed(),
      detailText: accumulatedText,
      latestToolHint,
      toolCalls: toolCallSummaries,
      ...overrides,
    });

    const clearScheduledProgress = () => {
      if (throttleHandle) {
        clearTimeout(throttleHandle);
        throttleHandle = null;
      }
    };

    const clearHeartbeat = () => {
      if (heartbeatHandle) {
        clearInterval(heartbeatHandle);
        heartbeatHandle = null;
      }
    };

    const scheduleProgressUpdate = (force = false) => {
      if (!cardMessageId || finalized || isCardUpdateDisabled()) return;

      const now = Date.now();
      const elapsed = now - lastProgressUpdateAt;

      if (!force && elapsed < PROGRESS_UPDATE_INTERVAL_MS) {
        if (throttleHandle) return;
        throttleHandle = setTimeout(() => {
          throttleHandle = null;
          scheduleProgressUpdate(true);
        }, PROGRESS_UPDATE_INTERVAL_MS - elapsed);
        return;
      }

      lastProgressUpdateAt = now;
      queueCardUpdate(() => buildProgressCard(buildRunCardContext()), 'progress');
    };

    const startHeartbeat = () => {
      if (!cardMessageId || finalized || isCardUpdateDisabled() || heartbeatHandle) return;
      heartbeatHandle = setInterval(() => {
        scheduleProgressUpdate(true);
      }, HEARTBEAT_INTERVAL_MS);
    };

    const clearProgressState = () => {
      clearScheduledProgress();
      clearHeartbeat();
    };

    // Send the initial progress card without blocking model startup.
    updateChain = sendCardMessage(larkClient, chatId, idType, buildThinkingCard(buildRunCardContext()), replyOptions)
      .then((messageId) => {
        cardMessageId = messageId;
        lastProgressUpdateAt = Date.now();
        if (!finalized) {
          startHeartbeat();
          if (accumulatedText || latestToolHint) {
            scheduleProgressUpdate(true);
          }
        }
      })
      .catch((err) => {
        console.error('[feishu] Failed to send thinking card:', getErrorMessage(err));
      });


    const sentImagePaths = new Set<string>();

    return {
      async onText(delta) {
        accumulatedText += delta;
        scheduleProgressUpdate();
      },

      async onToolCall(name, input) {
        latestToolHint = formatFeishuToolHint(name, input);
        rememberToolCall(toolCallSummaries, latestToolHint);
        scheduleProgressUpdate();
      },

      async onToolResult(toolResult) {
        const imageResult = extractGeneratedImageResult(toolResult);
        if (!imageResult) {
          return;
        }

        if (!existsSync(imageResult.outputPath) || sentImagePaths.has(imageResult.outputPath)) {
          return;
        }

        sentImagePaths.add(imageResult.outputPath);

        try {
          await sendImageMessage(chatId, idType, imageResult.outputPath, imageResult.mimeType, replyOptions);
          latestToolHint = '🖼️ Image generated and sent to Feishu';
          scheduleProgressUpdate(true);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[feishu] Failed to send generated image:', message);
          latestToolHint = `⚠️ Image generated but sending failed: ${message}`;
          scheduleProgressUpdate(true);
        }
      },

      async onClarification(req: ClarificationRequest) {
        const question = req.context
          ? `${req.question}\n\n_Context: ${req.context}_`
          : req.question;
        await sendTextMessage(larkClient, chatId, idType, `❓ ${question}`, replyOptions).catch(console.error);
      },

      async onDone(result) {
        clearProgressState();
        finalized = true;
        await updateChain;

        const doneCard = () => buildDoneCard(result, { toolCalls: toolCallSummaries, context: buildRunCardContext() });

        if (cardMessageId) {
          if (!isCardUpdateDisabled()) {
            const ok = await tryUpdateCard(doneCard, 'done', { allowFinal: true });
            if (ok) {
              return;
            }
          }

          await sendCardMessage(larkClient, chatId, idType, doneCard(), replyOptions).catch((err) => {
            console.error('[feishu] Failed to send done card fallback:', err);
          });
        } else {
          await sendTextMessage(larkClient, chatId, idType, result || '✅ Done', replyOptions).catch(console.error);
        }

        if (sourceMessageId && allowReaction) {
          addMessageReaction(sourceMessageId, 'DONE').catch((reactionErr) => {
            console.warn('[feishu] Failed to add DONE reaction:', getErrorMessage(reactionErr));
          });
        }
      },

      async onError(err) {
        clearProgressState();
        finalized = true;
        await updateChain;

        if (cardMessageId) {
          if (!isCardUpdateDisabled()) {
            const ok = await tryUpdateCard(() => buildErrorCard(err.message, buildRunCardContext()), 'error', { allowFinal: true });
            if (ok) {
              return;
            }
          }

          await sendCardMessage(larkClient, chatId, idType, buildErrorCard(err.message, buildRunCardContext()), replyOptions).catch((sendErr) => {
            console.error('[feishu] Failed to send error card fallback:', sendErr);
          });
        } else {
          await sendTextMessage(larkClient, chatId, idType, `❌ ${err.message}`, replyOptions).catch(console.error);
        }
      },
    };
  }
}
function rememberToolCall(toolCallSummaries: string[], summary: string): void {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (!normalized || toolCallSummaries[toolCallSummaries.length - 1] === normalized) {
    return;
  }

  const maxToolCalls = 30;
  toolCallSummaries.push(trimFeishuToolInput(normalized));
  if (toolCallSummaries.length > maxToolCalls) {
    toolCallSummaries.splice(0, toolCallSummaries.length - maxToolCalls);
  }
}

function pruneMap<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size > maxSize) {
    map.delete(map.keys().next().value!);
  }
}

interface FeishuChatMeta {
  chatId: string;
  chatIdType: 'open_id' | 'chat_id';
  sourceMessageId?: string;
  topicId?: string;
  allowReaction?: boolean;
}

function extractFeishuEvent(body: Record<string, unknown>): Record<string, unknown> | null {
  const wrappedEvent = body['event'];
  if (isRecord(wrappedEvent)) {
    return wrappedEvent;
  }

  if (isRecord(body['message']) && isRecord(body['sender'])) {
    return body;
  }

  return null;
}

function resolveFeishuChatMeta(input: {
  chatId?: string;
  chatType?: string;
  openId: string;
  sourceMessageId?: string;
  topicId?: string;
}): FeishuChatMeta {
  if (input.chatType === 'group' && input.chatId) {
    return {
      chatId: input.chatId,
      chatIdType: 'chat_id',
      sourceMessageId: input.sourceMessageId,
      topicId: input.topicId,
    };
  }

  return {
    chatId: input.openId,
    chatIdType: 'open_id',
    sourceMessageId: input.sourceMessageId,
  };
}

function resolveFeishuChatMetaFromPlatformKey(platformKey: string): FeishuChatMeta {
  const parsed = parseFeishuPlatformKey(platformKey);
  if (parsed?.kind === 'group') {
    return {
      chatId: parsed.chatId,
      chatIdType: 'chat_id',
      topicId: parsed.topicId,
    };
  }

  return {
    chatId: parsed?.openId ?? platformKey.replace('feishu:', ''),
    chatIdType: 'open_id',
  };
}

function shouldAddFeishuReactions(isGroupChat: boolean): boolean {
  const value = process.env.FEISHU_ENABLE_REACTIONS?.trim().toLowerCase();
  if (value === 'true' || value === '1' || value === 'yes') {
    return true;
  }
  if (value === 'group' || value === 'groups') {
    return isGroupChat;
  }
  if (value === 'false' || value === '0' || value === 'no') {
    return false;
  }

  return false;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function removeFeishuMentions(text: string, mentions: unknown[]): string {
  const mentionTexts = collectFeishuMentionTexts(mentions);
  let normalized = text;

  for (const mentionText of mentionTexts) {
    normalized = normalized.replace(new RegExp(escapeRegExp(mentionText), 'g'), ' ');
  }

  return normalized.replace(/\s+/g, ' ').trim();
}

function collectFeishuMentionTexts(mentions: unknown[]): string[] {
  const values = new Set<string>();

  for (const mention of mentions) {
    if (!isRecord(mention)) {
      continue;
    }

    const key = asNonEmptyString(mention.key);
    if (key) {
      values.add(key);
    }

    const name = asNonEmptyString(mention.name);
    if (name) {
      values.add(name.startsWith('@') ? name : `@${name}`);
    }
  }

  return [...values].sort((a, b) => b.length - a.length);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatFeishuToolHint(name: string, input: unknown): string {
  const toolName = name.trim() || 'unknown';
  const serializedInput = serializeToolInputForFeishu(input);

  if (!serializedInput) {
    return `🛠️ Calling tool: \`${toolName}\``;
  }

  return `🛠️ Calling tool: \`${toolName}\`\nArgs: \`${serializedInput}\``;
}

function serializeToolInputForFeishu(input: unknown): string {
  if (input === undefined || input === null) {
    return '';
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed ? trimFeishuToolInput(trimmed) : '';
  }

  try {
    const serialized = JSON.stringify(input);
    if (!serialized || serialized === '{}' || serialized === '[]') {
      return '';
    }
    return trimFeishuToolInput(serialized);
  } catch {
    return '[unserializable]';
  }
}

function trimFeishuToolInput(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  const maxLength = 220;
  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxLength - 3)}...`;
}
type RunCardCommand = 'status' | 'stop' | 'retry' | 'new' | 'runId';

interface RunCardAction {
  command: RunCardCommand;
  platformKey: string;
  memoryKey?: string;
  streamId?: string;
  runId?: string;
  prompt?: string;
  syntheticStreamId: string;
  replyTarget: {
    chatId: string;
    chatIdType: 'open_id' | 'chat_id';
  };
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
    open_chat_id?: string;
    chat_id?: string;
  };
  action?: {
    value?: Record<string, unknown>;
    form_value?: Record<string, unknown>;
    behaviors?: Array<{ value?: Record<string, unknown> }>;
  };
  event?: FeishuCardActionEvent;
}

function parseRunCardAction(data: unknown): RunCardAction | null {
  const event = unwrapCardActionEvent(data);
  const value = cardActionValue(event);
  if (!value || value.action !== 'pulse.run_card') {
    return null;
  }

  const command = asRunCardCommand(value.command);
  const platformKey = asNonEmptyString(value.platformKey);
  if (!command || !platformKey) {
    return null;
  }

  const openId = event.open_id
    ?? event.user_id
    ?? event.operator?.open_id
    ?? event.operator?.user_id
    ?? event.operator?.operator_id?.open_id
    ?? event.operator?.operator_id?.user_id;
  const actorId = asNonEmptyString(openId);
  if (actorId && !isRunCardActorAllowed(platformKey, actorId)) {
    return null;
  }
  const chatId = asNonEmptyString(event.context?.open_chat_id)
    ?? asNonEmptyString(event.context?.chat_id);
  const parsedPlatformKey = parseFeishuPlatformKey(platformKey);
  const replyTarget = parsedPlatformKey?.kind === 'group'
    ? { chatId: chatId ?? parsedPlatformKey.chatId, chatIdType: 'chat_id' as const }
    : { chatId: asNonEmptyString(openId) ?? parsedPlatformKey?.openId ?? '', chatIdType: 'open_id' as const };

  if (!replyTarget.chatId) {
    return null;
  }

  const cardMessageId = event.open_message_id
    ?? event.message_id
    ?? event.context?.open_message_id
    ?? event.context?.message_id
    ?? 'card';
  const streamId = asNonEmptyString(value.streamId);
  const runId = asNonEmptyString(value.runId);

  return {
    command,
    platformKey,
    memoryKey: asNonEmptyString(value.memoryKey) ?? undefined,
    streamId: streamId ?? undefined,
    runId: runId ?? undefined,
    prompt: asNonEmptyString(value.prompt) ?? undefined,
    syntheticStreamId: `feishu-card:${cardMessageId}:${actorId ?? 'unknown'}:${command}:${streamId ?? runId ?? Date.now()}`,
    replyTarget,
  };
}

function textForRunCardAction(action: RunCardAction): string | null {
  switch (action.command) {
    case 'status':
      return '/status';
    case 'stop':
      return '/stop';
    case 'new':
      return '/new';
    case 'retry':
      return action.prompt?.trim() || null;
    case 'runId':
      return action.runId
        ? `Run ID: ${action.runId}\nStream ID: ${action.streamId ?? '-'}`
        : `Stream ID: ${action.streamId ?? '-'}`;
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

function asRunCardCommand(value: unknown): RunCardCommand | null {
  if (value === 'status' || value === 'stop' || value === 'retry' || value === 'new' || value === 'runId') {
    return value;
  }
  return null;
}

function isRunCardActorAllowed(platformKey: string, actorOpenId: string): boolean {
  const parsed = parseFeishuPlatformKey(platformKey);
  if (parsed) {
    return parsed.openId === actorOpenId;
  }

  return true;
}


export const feishuAdapter = new FeishuAdapter();
