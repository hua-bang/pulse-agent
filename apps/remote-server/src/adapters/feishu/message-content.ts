import type { IncomingAttachment } from '../../core/types.js';

export function parseFeishuMessageContent(
  messageType: string | null,
  rawContent: unknown,
  messageId?: string,
): { text: string; attachments: IncomingAttachment[] } | null {
  if (typeof rawContent !== 'string') {
    return null;
  }

  let content: unknown;
  try {
    content = JSON.parse(rawContent || '{}');
  } catch {
    return null;
  }

  if (!isRecord(content)) {
    return null;
  }

  if (messageType === 'text') {
    return {
      text: asNonEmptyString(content.text) ?? '',
      attachments: [],
    };
  }

  if (messageType === 'image') {
    const imageKey = asNonEmptyString(content.image_key);
    if (!imageKey) {
      return null;
    }

    return {
      text: '',
      attachments: [buildFeishuImageAttachment(imageKey, messageId)],
    };
  }

  if (messageType === 'post') {
    return parseFeishuPostContent(content, messageId);
  }

  return null;
}

function parseFeishuPostContent(content: Record<string, unknown>, messageId?: string): { text: string; attachments: IncomingAttachment[] } {
  const textParts: string[] = [];
  const attachments: IncomingAttachment[] = [];
  const visited = new Set<unknown>();

  const visit = (value: unknown): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === 'string') {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (!isRecord(value) || visited.has(value)) {
      return;
    }
    visited.add(value);

    const tag = asNonEmptyString(value.tag);
    if (tag === 'img' || tag === 'image') {
      const imageKey = asNonEmptyString(value.image_key) ?? asNonEmptyString(value.imageKey);
      if (imageKey) {
        attachments.push(buildFeishuImageAttachment(imageKey, messageId));
      }
      return;
    }

    const text = asNonEmptyString(value.text)
      ?? asNonEmptyString(value.content)
      ?? asNonEmptyString(value.name)
      ?? asNonEmptyString(value.title);
    if (text) {
      textParts.push(text);
    }

    for (const childKey of ['content', 'elements', 'children', 'zh_cn', 'en_us', 'ja_jp']) {
      const child = value[childKey];
      if (child) {
        visit(child);
      }
    }
  };

  visit(content);

  return {
    text: textParts.join(' ').replace(/\s+/g, ' ').trim(),
    attachments: dedupeFeishuImageAttachments(attachments),
  };
}

function buildFeishuImageAttachment(imageKey: string, messageId?: string): IncomingAttachment {
  return {
    id: imageKey,
    url: `feishu://image/${encodeURIComponent(imageKey)}`,
    name: `${sanitizeFeishuImageKey(imageKey)}.jpg`,
    mimeType: 'image/jpeg',
    source: 'feishu',
    messageId,
  };
}

function dedupeFeishuImageAttachments(attachments: IncomingAttachment[]): IncomingAttachment[] {
  const seen = new Set<string>();
  const unique: IncomingAttachment[] = [];
  for (const attachment of attachments) {
    const key = attachment.id ?? attachment.url;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(attachment);
  }
  return unique;
}

function sanitizeFeishuImageKey(imageKey: string): string {
  return imageKey.replace(/[^a-zA-Z0-9._-]/g, '_') || 'feishu-image';
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
