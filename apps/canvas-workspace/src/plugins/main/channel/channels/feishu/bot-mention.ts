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
  return new Set(Object.values(normalizedIdentityByKind(identity)));
}

function normalizedIdentityByKind(identity: FeishuBotIdentity | undefined): Record<string, string> {
  const pairs: Array<[string, string | undefined]> = [
    ['app_id', identity?.appId],
    ['open_id', identity?.openId],
    ['user_id', identity?.userId],
    ['union_id', identity?.unionId],
  ];
  const out: Record<string, string> = {};
  for (const [kind, value] of pairs) {
    const normalized = value?.trim().toLowerCase();
    if (normalized) out[kind] = normalized;
  }
  return out;
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

interface MentionIdField {
  kind: string;
  value: string;
}

function normalizeIdKind(kind: string): string {
  return kind
    .replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
    .replace(/^_/, '')
    .toLowerCase();
}

function pushStringField(kind: string, value: unknown, out: MentionIdField[]): void {
  if (typeof value !== 'string') return;
  const normalized = value.trim().toLowerCase();
  if (normalized) out.push({ kind: normalizeIdKind(kind), value: normalized });
}

function collectMentionIdFields(mention: unknown): MentionIdField[] {
  if (!mention || typeof mention !== 'object') return [];
  const record = mention as Record<string, unknown>;
  const values: MentionIdField[] = [];
  const nestedId = record.id;
  if (nestedId && typeof nestedId === 'object' && !Array.isArray(nestedId)) {
    const nested = nestedId as Record<string, unknown>;
    for (const key of ['app_id', 'appId', 'open_id', 'openId', 'user_id', 'userId', 'union_id', 'unionId']) {
      pushStringField(key, nested[key], values);
    }
  } else {
    pushStringField('id', nestedId, values);
  }
  for (const key of ['app_id', 'appId', 'open_id', 'openId', 'user_id', 'userId', 'union_id', 'unionId']) {
    pushStringField(key, record[key], values);
  }
  return values;
}

function mentionMatchesBot(mention: unknown, identity: FeishuBotIdentity | undefined): boolean {
  const ids = normalizedIdentityValues(identity);
  const idsByKind = normalizedIdentityByKind(identity);
  const name = normalizedBotName(identity);
  if (ids.size === 0 && !name) return false;

  const idValues = collectMentionIdFields(mention);
  const comparableIds = idValues.filter((field) => field.kind in idsByKind);
  if (comparableIds.length > 0) {
    return comparableIds.some((field) => idsByKind[field.kind] === field.value);
  }
  const genericIds = idValues.filter((field) => field.kind === 'id');
  if (genericIds.length > 0) {
    return genericIds.some((field) => ids.has(field.value));
  }

  return Boolean(name && mentionName(mention)?.toLowerCase() === name);
}

function markerIdFields(attrs: string): MentionIdField[] {
  return Array.from(attrs.matchAll(/\b([\w:-]+)\s*=\s*["']([^"']+)["']/g))
    .map((attr) => ({ kind: normalizeIdKind(attr[1]), value: attr[2].trim().toLowerCase() }))
    .filter((field) => Boolean(field.value));
}

function hasBotMentionMarker(text: string, identity: FeishuBotIdentity | undefined): boolean {
  const ids = normalizedIdentityValues(identity);
  const idsByKind = normalizedIdentityByKind(identity);
  const name = normalizedBotName(identity);
  if (ids.size === 0 && !name) return false;

  const markerPattern = /<at\b([^>]*)>(.*?)<\/at>/gis;
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(text))) {
    const [, attrs, label] = match;
    const attrValues = markerIdFields(attrs);
    const comparableIds = attrValues.filter((field) => field.kind in idsByKind);
    if (comparableIds.length > 0) {
      if (comparableIds.some((field) => idsByKind[field.kind] === field.value)) return true;
      continue;
    }
    const genericIds = attrValues.filter((field) => field.kind === 'id');
    if (genericIds.length > 0) {
      if (genericIds.some((field) => ids.has(field.value))) return true;
      continue;
    }

    const cleanLabel = label.replace(/<[^>]*>/g, '').trim().toLowerCase();
    if (name && cleanLabel === name) return true;
  }
  return false;
}
