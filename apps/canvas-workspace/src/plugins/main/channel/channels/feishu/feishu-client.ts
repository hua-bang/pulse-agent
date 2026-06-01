import * as lark from '@larksuiteoapi/node-sdk';
import { readFile } from 'fs/promises';
import { basename } from 'path';

// Self-contained Feishu (Lark) client helpers for the canvas channel plugin.
// Logic mirrors the remote-server adapter but is copied here so the canvas
// app carries no dependency on remote-server. Credentials come from the
// FEISHU_APP_ID / FEISHU_APP_SECRET environment variables.

export function feishuConfigured(): boolean {
  return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

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

  const response = await fetch(
    `${getFeishuBaseUrl()}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to get Feishu tenant access token: ${response.status} ${response.statusText} - ${body}`,
    );
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

  const response = await fetch(`${getFeishuBaseUrl()}/open-apis/im/v1/images`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to upload image to Feishu: ${response.status} ${response.statusText} - ${body}`,
    );
  }

  const payload = (await response.json()) as FeishuApiResponse<{ image_key?: string }>;
  const imageKey = payload.data?.image_key;
  if (payload.code !== 0 || !imageKey) {
    throw new Error(`Failed to upload image to Feishu: ${payload.msg || 'unknown error'}`);
  }
  return imageKey;
}

/**
 * Where a reply goes. For a normal chat we create a message addressed to
 * `chatId`. For a **topic group** (`threadId` set) we instead reply to the
 * triggering message with `reply_in_thread`, so the message lands in the
 * right topic rather than the group root.
 */
export interface FeishuSendTarget {
  chatId: string;
  threadId?: string;
  /** The inbound message we reply to, to continue a topic-group thread. */
  triggerMessageId: string;
}

/**
 * Send a message to a target, choosing create-vs-reply based on whether the
 * conversation is threaded. Returns the new message_id.
 */
async function createOrReply(
  client: lark.Client,
  target: FeishuSendTarget,
  msgType: 'text' | 'interactive' | 'image',
  content: string,
): Promise<string> {
  if (target.threadId && target.triggerMessageId) {
    const res = await client.im.message.reply({
      path: { message_id: target.triggerMessageId },
      data: { content, msg_type: msgType, reply_in_thread: true },
    });
    if (typeof res.code === 'number' && res.code !== 0) {
      throw new Error(`Feishu reply failed: ${res.code} ${res.msg ?? 'unknown error'}`);
    }
    return res.data?.message_id ?? '';
  }

  const res = await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: target.chatId, msg_type: msgType, content },
  });
  if (typeof res.code === 'number' && res.code !== 0) {
    throw new Error(`Feishu send failed: ${res.code} ${res.msg ?? 'unknown error'}`);
  }
  return res.data?.message_id ?? '';
}

/** Upload a local image and send it to the target. Returns the message_id. */
export async function sendImageMessage(
  client: lark.Client,
  target: FeishuSendTarget,
  imagePath: string,
  mimeType?: string,
): Promise<string> {
  const imageKey = await uploadImageToFeishu(imagePath, mimeType);
  return createOrReply(client, target, 'image', JSON.stringify({ image_key: imageKey }));
}

/** Send a plain text message to the target. Returns the message_id. */
export async function sendTextMessage(
  client: lark.Client,
  target: FeishuSendTarget,
  text: string,
): Promise<string> {
  return createOrReply(client, target, 'text', JSON.stringify({ text }));
}

/** Send an interactive card message to the target. Returns the message_id. */
export async function sendCardMessage(
  client: lark.Client,
  target: FeishuSendTarget,
  card: object,
): Promise<string> {
  return createOrReply(client, target, 'interactive', JSON.stringify(card));
}

/** Update (patch) an existing card message with new content. */
export async function updateCardMessage(
  client: lark.Client,
  messageId: string,
  card: object,
): Promise<void> {
  const res = await client.im.message.patch({
    path: { message_id: messageId },
    data: { content: JSON.stringify(card) },
  });
  if (typeof res.code === 'number' && res.code !== 0) {
    throw new Error(`Feishu update card failed: ${res.code} ${res.msg ?? 'unknown error'}`);
  }
}
