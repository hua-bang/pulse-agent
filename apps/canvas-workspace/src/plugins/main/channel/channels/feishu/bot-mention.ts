import { getFeishuBotInfo, type FeishuBotInfo } from './feishu-client';

export interface FeishuBotIdentity {
  appId?: string;
  openId?: string;
  userId?: string;
  unionId?: string;
  name?: string;
}

export async function loadBotIdentity(appId: string): Promise<FeishuBotIdentity> {
  const envIdentity = envBotIdentity(appId);
  try {
    const info = await getFeishuBotInfo();
    return mergeBotIdentity(envIdentity, info);
  } catch (err) {
    console.warn('[channel:feishu] failed to load bot identity; group @ filtering will use env fallback', err);
    return envIdentity;
  }
}

export function messageMentionsBot(
  mentions: unknown[],
  text: string,
  identity: FeishuBotIdentity | undefined,
): boolean {
  return mentions.some((mention) => mentionMatchesBot(mention, identity))
    || hasBotMentionMarker(text, identity);
}

function envBotIdentity(appId: string): FeishuBotIdentity {
  return {
    appId,
    openId: process.env.FEISHU_BOT_OPEN_ID?.trim() || undefined,
    userId: process.env.FEISHU_BOT_USER_ID?.trim() || undefined,
    unionId: process.env.FEISHU_BOT_UNION_ID?.trim() || undefined,
    name: process.env.FEISHU_BOT_NAME?.trim() || undefined,
  };
}

function mergeBotIdentity(base: FeishuBotIdentity, info: FeishuBotInfo): FeishuBotIdentity {
  return {
    ...base,
    openId: info.openId?.trim() || base.openId,
    name: info.appName?.trim() || base.name,
  };
}

function normalizedIdentityValues(identity: FeishuBotIdentity | undefined): Set<string> {
  const values = [identity?.appId, identity?.openId, identity?.userId, identity?.unionId]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return new Set(values);
}

function normalizedBotName(identity: FeishuBotIdentity | undefined): string | null {
  const name = identity?.name?.trim().toLowerCase();
  return name || null;
}

function mentionName(mention: unknown): string | null {
  if (!mention || typeof mention !== 'object') return null;
  const value = (mention as Record<string, unknown>).name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function collectStringFields(value: unknown, out: string[]): void {
  if (!value) return;
  if (typeof value === 'string') {
    if (value.trim()) out.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringFields(item, out);
    return;
  }
  if (typeof value !== 'object') return;

  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectStringFields(nested, out);
  }
}

function collectMentionIdFields(mention: unknown): string[] {
  if (!mention || typeof mention !== 'object') return [];
  const record = mention as Record<string, unknown>;
  const values: string[] = [];
  collectStringFields(record.id, values);
  collectStringFields(record.open_id, values);
  collectStringFields(record.user_id, values);
  collectStringFields(record.union_id, values);
  return values;
}

function mentionMatchesBot(mention: unknown, identity: FeishuBotIdentity | undefined): boolean {
  const ids = normalizedIdentityValues(identity);
  const name = normalizedBotName(identity);
  if (ids.size === 0 && !name) return false;

  const idValues = collectMentionIdFields(mention);
  if (ids.size > 0 && idValues.length > 0) {
    return idValues.some((value) => ids.has(value.trim().toLowerCase()));
  }

  return Boolean(name && mentionName(mention)?.toLowerCase() === name);
}

function hasBotMentionMarker(text: string, identity: FeishuBotIdentity | undefined): boolean {
  const ids = normalizedIdentityValues(identity);
  const name = normalizedBotName(identity);
  if (ids.size === 0 && !name) return false;

  const markerPattern = /<at\b([^>]*)>(.*?)<\/at>/gis;
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(text))) {
    const [, attrs, label] = match;
    const attrValues = Array.from(attrs.matchAll(/\b[\w:-]+\s*=\s*["']([^"']+)["']/g))
      .map((attr) => attr[1].trim().toLowerCase())
      .filter(Boolean);
    if (ids.size > 0 && attrValues.length > 0) {
      if (attrValues.some((value) => ids.has(value))) return true;
      continue;
    }

    const cleanLabel = label.replace(/<[^>]*>/g, '').trim().toLowerCase();
    if (name && cleanLabel === name) return true;
  }
  return false;
}
