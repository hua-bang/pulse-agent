import * as lark from '@larksuiteoapi/node-sdk';
import { readFile } from 'fs/promises';
import { basename } from 'path';

/**
 * Create a Feishu SDK Client instance.
 * Token refresh, retry, and domain routing are all handled by the SDK.
 */
export function createLarkClient(): lark.Client {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required');
  }
  return new lark.Client({
    appId,
    appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });
}


interface FeishuApiResponse<T> {
  code: number;
  msg: string;
  data?: T;
}

let cachedTenantAccessToken: string | null = null;
let tenantAccessTokenExpiresAt = 0;

function getFeishuBaseUrl(): string {
  const envBaseUrl = process.env.FEISHU_API_BASE_URL?.trim();
  return (envBaseUrl || 'https://open.feishu.cn').replace(/\/$/, '');
}

async function getTenantAccessToken(): Promise<string> {
  if (cachedTenantAccessToken && Date.now() < tenantAccessTokenExpiresAt - 60_000) {
    return cachedTenantAccessToken;
  }

  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required');
  }

  const response = await fetch(`${getFeishuBaseUrl()}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to get Feishu tenant access token: ${response.status} ${response.statusText} - ${body}`);
  }

  const payload = (await response.json()) as FeishuApiResponse<never> & {
    tenant_access_token?: string;
    expire?: number;
  };

  if (payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`Failed to get Feishu tenant access token: ${payload.msg || 'unknown error'}`);
  }

  cachedTenantAccessToken = payload.tenant_access_token;
  tenantAccessTokenExpiresAt = Date.now() + (payload.expire ?? 7200) * 1000;

  return cachedTenantAccessToken;
}

async function uploadImageToFeishu(imagePath: string, mimeType?: string): Promise<string> {
  const imageBuffer = await readFile(imagePath);
  if (imageBuffer.length === 0) {
    throw new Error(`Image file is empty: ${imagePath}`);
  }

  const token = await getTenantAccessToken();
  const formData = new FormData();
  const filename = basename(imagePath);

  formData.append('image_type', 'message');
  formData.append('image', new Blob([imageBuffer], { type: mimeType || 'image/png' }), filename);

  const response = await fetchFeishuWithRetry({
    url: `${getFeishuBaseUrl()}/open-apis/im/v1/images`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: formData,
    },
    action: 'upload image',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to upload image to Feishu: ${response.status} ${response.statusText} - ${body}`);
  }

  const payload = (await response.json()) as FeishuApiResponse<{ image_key?: string }>;
  const imageKey = payload.data?.image_key;

  if (payload.code !== 0 || !imageKey) {
    throw new Error(`Failed to upload image to Feishu: ${payload.msg || 'unknown error'}`);
  }

  return imageKey;
}

export async function downloadMessageImageResourceFromFeishu(input: {
  messageId: string;
  fileKey: string;
}): Promise<{ buffer: Buffer; mimeType?: string; size?: number }> {
  const messageId = input.messageId.trim();
  const fileKey = input.fileKey.trim();
  if (!messageId) {
    throw new Error('messageId is required to download a Feishu message image resource');
  }
  if (!fileKey) {
    throw new Error('fileKey is required to download a Feishu message image resource');
  }

  const token = await getTenantAccessToken();
  const response = await fetchFeishuWithRetry({
    url: `${getFeishuBaseUrl()}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=image`,
    init: {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
    action: 'download message image resource',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to download Feishu message image resource: ${response.status} ${response.statusText} - ${body}`);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || undefined;
  if (contentType === 'application/json') {
    const body = await response.text();
    throw new Error(`Failed to download Feishu message image resource: ${body}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error(`Downloaded Feishu message image resource is empty: ${messageId}/${fileKey}`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? '0');

  return {
    buffer,
    mimeType: contentType,
    size: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : buffer.length,
  };
}

type ReceiveIdType = 'open_id' | 'chat_id' | 'user_id' | 'union_id' | 'email';

interface RunCardContext {
  platformKey: string;
  memoryKey?: string;
  streamId: string;
  runId?: string;
  prompt?: string;
  elapsed?: string;
  detailText?: string;
  latestToolHint?: string;
  toolCalls?: string[];
}

interface DoneCardOptions {
  toolCalls?: string[];
  context?: RunCardContext;
}

interface SendMessageOptions {
  replyToMessageId?: string;
}

const FEISHU_API_MAX_ATTEMPTS = 3;

function normalizeReplyToMessageId(options?: SendMessageOptions): string | undefined {
  const replyToMessageId = options?.replyToMessageId?.trim();
  return replyToMessageId || undefined;
}

async function replyMessage(
  messageId: string,
  msgType: 'text' | 'interactive' | 'image',
  content: string,
): Promise<string> {
  const token = await getTenantAccessToken();
  const response = await fetchFeishuWithRetry({
    url: `${getFeishuBaseUrl()}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        msg_type: msgType,
        content,
      }),
    },
    action: 'reply message',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to reply message in Feishu: ${response.status} ${response.statusText} - ${body}`);
  }

  const payload = (await response.json()) as FeishuApiResponse<{ message_id?: string }>;
  if (payload.code !== 0) {
    throw new Error(`Failed to reply message in Feishu: ${payload.msg || 'unknown error'}`);
  }

  return payload.data?.message_id ?? '';
}

/**
 * Upload a local image and send it as a Feishu image message.
 * Returns the message_id of the sent message.
 */
export async function sendImageMessage(
  receiveId: string,
  receiveIdType: ReceiveIdType,
  imagePath: string,
  mimeType?: string,
  options?: SendMessageOptions,
): Promise<string> {
  const imageKey = await uploadImageToFeishu(imagePath, mimeType);
  const token = await getTenantAccessToken();
  const replyToMessageId = normalizeReplyToMessageId(options);
  const content = JSON.stringify({ image_key: imageKey });
  if (replyToMessageId) {
    try {
      return await replyMessage(replyToMessageId, 'image', content);
    } catch (err) {
      console.error('[feishu] Failed to reply image message:', err);
      throw err;
    }
  }

  const response = await fetchFeishuWithRetry({
    url: `${getFeishuBaseUrl()}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'image',
        content,
      }),
    },
    action: 'send image message',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to send image message to Feishu: ${response.status} ${response.statusText} - ${body}`);
  }

  const payload = (await response.json()) as FeishuApiResponse<{ message_id?: string }>;
  if (payload.code !== 0) {
    throw new Error(`Failed to send image message to Feishu: ${payload.msg || 'unknown error'}`);
  }

  return payload.data?.message_id ?? '';
}

/**
 * Add an emoji reaction to a message.
 */
export async function addMessageReaction(messageId: string, emojiType: string): Promise<void> {
  const token = await getTenantAccessToken();
  const normalizedEmojiType = emojiType.trim();
  if (!normalizedEmojiType) {
    throw new Error('emojiType is required');
  }

  const response = await fetchFeishuWithRetry({
    url: `${getFeishuBaseUrl()}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reaction_type: { emoji_type: normalizedEmojiType },
      }),
    },
    action: 'add message reaction',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to add message reaction in Feishu: ${response.status} ${response.statusText} - ${body}`);
  }

  const payload = (await response.json()) as FeishuApiResponse<unknown>;
  if (payload.code !== 0) {
    throw new Error(`Failed to add message reaction in Feishu: ${payload.msg || 'unknown error'}`);
  }
}

/**
 * Send a plain text message.
 * Returns the message_id of the sent message.
 */
export async function sendTextMessage(
  client: lark.Client,
  receiveId: string,
  receiveIdType: ReceiveIdType,
  text: string,
  options?: SendMessageOptions,
): Promise<string> {
  const replyToMessageId = normalizeReplyToMessageId(options);
  const content = JSON.stringify({ text });
  if (replyToMessageId) {
    try {
      return await replyMessage(replyToMessageId, 'text', content);
    } catch (err) {
      console.error('[feishu] Failed to reply text message:', err);
      throw err;
    }
  }

  const res = await retryFeishuOperation('send text message', () => client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      msg_type: 'text',
      content,
    },
  }));
  if (typeof res.code === 'number' && res.code !== 0) {
    throw new Error(`Feishu send text failed: ${res.code} ${res.msg ?? 'unknown error'}`);
  }
  return res.data?.message_id ?? '';
}

/**
 * Send an interactive card message.
 * Returns the message_id of the sent message.
 */
export async function sendCardMessage(
  client: lark.Client,
  receiveId: string,
  receiveIdType: ReceiveIdType,
  card: object,
  options?: SendMessageOptions,
): Promise<string> {
  const replyToMessageId = normalizeReplyToMessageId(options);
  const content = JSON.stringify(card);
  if (replyToMessageId) {
    try {
      return await replyMessage(replyToMessageId, 'interactive', content);
    } catch (err) {
      console.error('[feishu] Failed to reply card message:', err);
      throw err;
    }
  }

  const res = await retryFeishuOperation('send card message', () => client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      msg_type: 'interactive',
      content,
    },
  }));
  if (typeof res.code === 'number' && res.code !== 0) {
    throw new Error(`Feishu send card failed: ${res.code} ${res.msg ?? 'unknown error'}`);
  }
  return res.data?.message_id ?? '';
}

/**
 * Update (patch) an existing card message with new content.
 */
export async function updateCardMessage(
  client: lark.Client,
  messageId: string,
  card: object,
): Promise<void> {
  const res = await retryFeishuOperation('update card message', () => client.im.message.patch({
    path: { message_id: messageId },
    data: { content: JSON.stringify(card) },
  }));
  if (typeof res.code === 'number' && res.code !== 0) {
    throw new Error(`Feishu update card failed: ${res.code} ${res.msg ?? 'unknown error'}`);
  }
}

async function fetchFeishuWithRetry(input: {
  url: string;
  init: RequestInit;
  action: string;
}): Promise<Response> {
  return retryFeishuOperation(input.action, async () => {
    const response = await fetch(input.url, input.init);
    if (isRetriableStatus(response.status)) {
      throw new RetriableFeishuResponseError(input.action, response.status, response.statusText);
    }
    return response;
  });
}

async function retryFeishuOperation<T>(action: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= FEISHU_API_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt >= FEISHU_API_MAX_ATTEMPTS || !isRetriableFeishuError(err)) {
        throw err;
      }

      const delayMs = getRetryDelayMs(attempt);
      console.warn(
        `[feishu] ${action} failed transiently; retrying ${attempt + 1}/${FEISHU_API_MAX_ATTEMPTS} in ${delayMs}ms: ${getErrorMessage(err)}`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

class RetriableFeishuResponseError extends Error {
  constructor(
    action: string,
    readonly status: number,
    statusText: string,
  ) {
    super(`Feishu ${action} failed transiently: ${status} ${statusText}`);
  }
}

function isRetriableFeishuError(err: unknown): boolean {
  if (err instanceof RetriableFeishuResponseError) {
    return true;
  }

  const status = readNumericPath(err, 'response', 'status') ?? readNumericPath(err, 'status');
  if (typeof status === 'number') {
    return isRetriableStatus(status);
  }

  const code = readStringPath(err, 'code');
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) {
    return true;
  }

  const message = getErrorMessage(err).toLowerCase();
  return message.includes('socket hang up')
    || message.includes('fetch failed')
    || message.includes('network')
    || message.includes('timeout');
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function getRetryDelayMs(attempt: number): number {
  return 350 * 2 ** (attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readNumericPath(value: unknown, ...path: string[]): number | undefined {
  const found = readPath(value, ...path);
  return typeof found === 'number' ? found : undefined;
}

function readStringPath(value: unknown, ...path: string[]): string | undefined {
  const found = readPath(value, ...path);
  return typeof found === 'string' ? found : undefined;
}

function readPath(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Card builders ────────────────────────────────────────────────────────────

const MAX_CARD_TEXT_LENGTH = 7000;
const FEISHU_RUN_CARD_ACTION = 'pulse.run_card';

function clampCardText(text: string, maxLength = MAX_CARD_TEXT_LENGTH): string {
  if (text.length <= maxLength) return text;
  return `...${text.slice(text.length - maxLength)}`;
}

function formatCardDetailText(...parts: Array<string | undefined>): string {
  const normalizedParts = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return clampCardText(normalizedParts.join('\n\n'));
}

function md(content: string): object {
  return { tag: 'markdown', content };
}

function plainText(content: string): object {
  return { tag: 'plain_text', content };
}

function buildCard(title: string, template: string, elements: object[], enableForward: boolean): object {
  return {
    schema: '2.0',
    config: { enable_forward: enableForward, wide_screen_mode: true },
    header: {
      template,
      title: plainText(title),
    },
    body: { elements },
  };
}

function runActionButton(
  command: 'status' | 'stop' | 'retry' | 'new' | 'runId',
  text: string,
  context: RunCardContext,
  type: 'default' | 'primary' | 'danger' = 'default',
): object {
  const value = {
    action: FEISHU_RUN_CARD_ACTION,
    command,
    platformKey: context.platformKey,
    memoryKey: context.memoryKey,
    streamId: context.streamId,
    runId: context.runId,
    prompt: context.prompt,
  };
  return {
    tag: 'button',
    text: plainText(text),
    type,
    width: 'fill',
    value,
    behaviors: [{ type: 'callback', value }],
  };
}

function buttonRow(buttons: object[]): object {
  return {
    tag: 'column_set',
    flex_mode: 'bisect',
    horizontal_spacing: '8px',
    columns: buttons.map((button) => ({
      tag: 'column',
      width: 'weighted',
      weight: 1,
      elements: [button],
    })),
  };
}

function buildRunMeta(context: RunCardContext, status: string): string {
  const lines = [`**状态**: ${status}`];
  if (context.elapsed) lines.push(`**耗时**: ${context.elapsed}`);
  if (context.runId) lines.push(`**runId**: \`${context.runId}\``);
  lines.push(`**streamId**: \`${context.streamId}\``);
  if (context.prompt) lines.push(`**请求**: ${clampCardText(context.prompt, 300)}`);
  return lines.join('\n');
}

function buildProgressElements(context: RunCardContext): object[] {
  const elements: object[] = [md(buildRunMeta(context, '运行中'))];
  const detailText = formatCardDetailText(context.latestToolHint, context.detailText);
  if (detailText) {
    elements.push(md(detailText));
  }
  elements.push(buttonRow([
    runActionButton('status', '状态', context, 'primary'),
    runActionButton('stop', '停止', context, 'danger'),
  ]));
  elements.push(buttonRow([
    runActionButton('runId', '查看 runId', context),
    runActionButton('new', '新会话', context),
  ]));
  return elements;
}

function buildCompletionActionElements(context: RunCardContext): object[] {
  return [
    buttonRow([
      runActionButton('retry', '重试', context, 'primary'),
      runActionButton('new', '新会话', context),
    ]),
    buttonRow([
      runActionButton('status', '状态', context),
      runActionButton('runId', '查看 runId', context),
    ]),
  ];
}

export function buildThinkingCard(context: RunCardContext): object {
  return buildCard('Pulse 正在处理', 'blue', buildProgressElements({
    ...context,
    detailText: '已收到请求，正在准备运行环境...',
  }), false);
}

export function buildProgressCard(context: RunCardContext): object {
  return buildCard('Pulse 正在处理', 'blue', buildProgressElements(context), false);
}

export function buildDoneCard(text: string, options: DoneCardOptions = {}): object {
  const context = options.context;
  const elements: object[] = [md(formatCardDetailText(text) || '✅ Done')];
  if (context) {
    elements.unshift(md(buildRunMeta(context, '已完成')));
  }
  const toolCalls = options.toolCalls?.filter(Boolean) ?? [];

  if (toolCalls.length > 0) {
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: {
        title: plainText(`工具调用明细 (${toolCalls.length})`),
      },
      elements: [md(toolCalls.map((toolCall, index) => `${index + 1}. ${toolCall}`).join('\n'))],
    });
  }

  if (context) {
    elements.push(...buildCompletionActionElements(context));
  }

  return buildCard('Pulse 已完成', 'green', elements, true);
}

export function buildErrorCard(message: string, context?: RunCardContext): object {
  const elements: object[] = [];
  if (context) {
    elements.push(md(buildRunMeta(context, '出错')));
  }
  elements.push(md(`❌ Error: ${clampCardText(message || 'unknown error', 3000)}`));
  if (context) {
    elements.push(...buildCompletionActionElements(context));
  }
  return buildCard('Pulse 运行出错', 'red', elements, false);
}
