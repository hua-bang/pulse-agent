export interface FeishuPlatformKeyInput {
  chatId?: string;
  chatType?: string;
  openId: string;
  topicId?: string;
}

export interface FeishuGroupPlatformKey {
  kind: 'group';
  chatId: string;
  openId: string;
  topicId?: string;
}

export interface FeishuDirectPlatformKey {
  kind: 'direct';
  openId: string;
}

export type ParsedFeishuPlatformKey = FeishuGroupPlatformKey | FeishuDirectPlatformKey;

export function buildFeishuPlatformKey(input: FeishuPlatformKeyInput): string {
  if (input.chatType === 'group' && input.chatId) {
    const topicId = sanitizeFeishuPlatformSegment(input.topicId);
    if (topicId) {
      return `feishu:group:${input.chatId}:topic:${topicId}:user:${input.openId}`;
    }

    return `feishu:group:${input.chatId}:user:${input.openId}`;
  }

  return `feishu:${input.openId}`;
}

export function parseFeishuPlatformKey(platformKey: string): ParsedFeishuPlatformKey | undefined {
  const normalized = platformKey.trim();

  const group = /^feishu:group:([^:]+)(?::topic:([^:]+))?(?::user)?:([^:]+)$/.exec(normalized);
  if (group) {
    return {
      kind: 'group',
      chatId: group[1],
      topicId: group[2],
      openId: group[3],
    };
  }

  const direct = /^feishu:([^:]+)$/.exec(normalized);
  if (direct) {
    return {
      kind: 'direct',
      openId: direct[1],
    };
  }

  return undefined;
}

export function resolveFeishuTopicId(message: Record<string, unknown>): string | undefined {
  return asNonEmptyString(message.root_id)
    ?? asNonEmptyString(message.parent_id)
    ?? asNonEmptyString(message.thread_id)
    ?? asNonEmptyString(message.message_id)
    ?? undefined;
}

function sanitizeFeishuPlatformSegment(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/:/g, '_');
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
