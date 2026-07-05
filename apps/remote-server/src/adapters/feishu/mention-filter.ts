interface FeishuBotInfo {
  appName?: string;
  openId?: string;
}

export interface FeishuBotMentionIdentity {
  openId?: string;
  userId?: string;
  unionId?: string;
  appId?: string;
  appName?: string;
  aliases?: string[];
}

let lastBotIdentityWarningAt = 0;

export async function isFeishuMessageMentioningCurrentBot(mentions: unknown[]): Promise<boolean> {
  if (mentions.length === 0) {
    return false;
  }

  const configuredIdentity = buildFeishuBotMentionIdentity();
  if (hasFeishuBotMentionIdentity(configuredIdentity)) {
    return isFeishuMessageMentioningBot(mentions, configuredIdentity);
  }

  try {
    const { getCurrentFeishuBotInfo } = await import('./client.js');
    const botInfo = await getCurrentFeishuBotInfo();
    const resolvedIdentity = buildFeishuBotMentionIdentity(botInfo ?? undefined);
    if (!hasFeishuBotMentionIdentity(resolvedIdentity)) {
      warnMissingBotIdentity('Feishu bot info did not include a usable mention identity');
      return false;
    }

    return isFeishuMessageMentioningBot(mentions, resolvedIdentity);
  } catch (err) {
    warnMissingBotIdentity(`Failed to resolve Feishu bot mention identity: ${getErrorMessage(err)}`);
    return false;
  }
}

export function isFeishuMessageMentioningBot(
  mentions: unknown[],
  identity: FeishuBotMentionIdentity,
): boolean {
  const expectedIds = collectExpectedMentionIds(identity);
  const expectedNames = collectExpectedMentionNames(identity);

  if (expectedIds.size === 0 && expectedNames.size === 0) {
    return false;
  }

  for (const mention of mentions) {
    if (!isRecord(mention)) {
      continue;
    }

    for (const candidate of collectMentionIdCandidates(mention)) {
      if (expectedIds.has(candidate)) {
        return true;
      }
    }

    for (const candidate of collectMentionNameCandidates(mention)) {
      if (expectedNames.has(candidate)) {
        return true;
      }
    }
  }

  return false;
}

function buildFeishuBotMentionIdentity(botInfo?: FeishuBotInfo): FeishuBotMentionIdentity {
  return {
    openId: envString('FEISHU_BOT_OPEN_ID') ?? botInfo?.openId,
    userId: envString('FEISHU_BOT_USER_ID'),
    unionId: envString('FEISHU_BOT_UNION_ID'),
    appId: envString('FEISHU_APP_ID'),
    appName: envString('FEISHU_BOT_NAME') ?? botInfo?.appName,
    aliases: envList('FEISHU_BOT_MENTION_ALIASES'),
  };
}

function hasFeishuBotMentionIdentity(identity: FeishuBotMentionIdentity): boolean {
  return collectExpectedMentionIds(identity).size > 0 || collectExpectedMentionNames(identity).size > 0;
}

function collectExpectedMentionIds(identity: FeishuBotMentionIdentity): Set<string> {
  const values = new Set<string>();
  for (const value of [identity.openId, identity.userId, identity.unionId, identity.appId]) {
    const normalized = normalizeExact(value);
    if (normalized) {
      values.add(normalized);
    }
  }
  return values;
}

function collectExpectedMentionNames(identity: FeishuBotMentionIdentity): Set<string> {
  const values = new Set<string>();
  for (const value of [identity.appName, ...(identity.aliases ?? [])]) {
    const normalized = normalizeMentionName(value);
    if (normalized) {
      values.add(normalized);
    }
  }
  return values;
}

function collectMentionIdCandidates(mention: Record<string, unknown>): Set<string> {
  const values = new Set<string>();
  addExact(values, mention.open_id);
  addExact(values, mention.user_id);
  addExact(values, mention.union_id);
  addExact(values, mention.app_id);

  const id = mention.id;
  if (typeof id === 'string') {
    addExact(values, id);
  } else if (isRecord(id)) {
    addExact(values, id.open_id);
    addExact(values, id.user_id);
    addExact(values, id.union_id);
    addExact(values, id.app_id);
  }

  return values;
}

function collectMentionNameCandidates(mention: Record<string, unknown>): Set<string> {
  const values = new Set<string>();
  addMentionName(values, mention.name);
  addMentionName(values, mention.key);
  return values;
}

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function envList(name: string): string[] {
  const value = process.env[name];
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function addExact(values: Set<string>, value: unknown): void {
  const normalized = normalizeExact(value);
  if (normalized) {
    values.add(normalized);
  }
}

function addMentionName(values: Set<string>, value: unknown): void {
  const normalized = normalizeMentionName(value);
  if (normalized) {
    values.add(normalized);
  }
}

function normalizeExact(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeMentionName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim().replace(/^@+/, '').trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function warnMissingBotIdentity(message: string): void {
  const now = Date.now();
  if (now - lastBotIdentityWarningAt < 60_000) {
    return;
  }

  lastBotIdentityWarningAt = now;
  console.warn(`[feishu] ${message}; ignoring group message because the current bot was not verified in mentions`);
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
