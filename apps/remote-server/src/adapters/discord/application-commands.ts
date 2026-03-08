import { DiscordClient, type DiscordApplicationCommandCreate } from './client.js';

const RESTART_COMMAND: DiscordApplicationCommandCreate = {
  name: 'restart',
  description: 'Restart process, check status, or update branch then restart.',
  options: [
    {
      type: 3,
      name: 'mode',
      description: 'Optional mode: status or update.',
      required: false,
      max_length: 16,
    },
    {
      type: 3,
      name: 'branch',
      description: 'Branch used when mode=update (default: master).',
      required: false,
      max_length: 64,
    },
  ],
};

export async function registerDiscordApplicationCommands(): Promise<void> {
  if (!parseEnabledFlag(process.env.DISCORD_COMMAND_REGISTER_ENABLED, true)) {
    console.log('[discord] Skip app command registration: DISCORD_COMMAND_REGISTER_ENABLED=false');
    return;
  }

  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    console.log('[discord] Skip app command registration: DISCORD_BOT_TOKEN is not set');
    return;
  }

  const client = new DiscordClient();
  const configuredApplicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const applicationId = configuredApplicationId || await client.getApplicationId();
  const guildIds = parseGuildIds(process.env.DISCORD_COMMAND_GUILD_IDS);

  if (guildIds.length === 0) {
    await client.upsertGlobalApplicationCommand(applicationId, RESTART_COMMAND);
    console.log('[discord] Registered global application command: /restart');
    return;
  }

  for (const guildId of guildIds) {
    await client.upsertGuildApplicationCommand(applicationId, guildId, RESTART_COMMAND);
  }

  console.log(`[discord] Registered guild application command /restart for ${guildIds.length} guild(s)`);
}

function parseGuildIds(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const values = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!/^\d+$/.test(value)) {
      continue;
    }

    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function parseEnabledFlag(value: string | undefined, defaultValue = true): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false;
  }

  return true;
}
