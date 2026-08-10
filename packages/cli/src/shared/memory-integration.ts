import { homedir } from 'os';
import { join } from 'path';
import {
  createMemoryIntegrationFromEnv,
  type MemoryIntegration,
} from 'pulse-coder-plugin-kit/memory';

const DEFAULT_MEMORY_USER = 'local';

const memoryPlatformKey = resolveMemoryPlatformKey();

let activeMemoryIntegration: MemoryIntegration | undefined;

function getMemoryIntegration(): MemoryIntegration {
  activeMemoryIntegration ??= createMemoryIntegrationFromEnv({
    env: process.env,
    baseDir: join(homedir(), '.pulse-coder', 'cli-memory'),
    pluginName: 'cli-memory',
    pluginVersion: '0.0.1',
  });
  return activeMemoryIntegration;
}

export const memoryIntegration: MemoryIntegration = {
  get service() {
    return getMemoryIntegration().service;
  },
  get enginePlugin() {
    return getMemoryIntegration().enginePlugin;
  },
  initialize: () => getMemoryIntegration().initialize(),
  withRunContext: (context, run) => getMemoryIntegration().withRunContext(context, run),
  getRunContext: () => getMemoryIntegration().getRunContext(),
};

interface BuildMemoryRunContextInput {
  sessionId: string;
  userText: string;
}

interface RecordDailyLogInput {
  sessionId: string;
  userText: string;
  assistantText: string;
}

export function buildMemoryRunContext(input: BuildMemoryRunContextInput) {
  return {
    platformKey: memoryPlatformKey,
    sessionId: input.sessionId,
    userText: input.userText,
  };
}

export async function recordDailyLogFromSuccessPath(input: RecordDailyLogInput): Promise<void> {
  const userText = input.userText.trim();
  const assistantText = input.assistantText.trim();
  if (!userText && !assistantText) {
    return;
  }

  try {
    await memoryIntegration.service.recordTurn({
      platformKey: memoryPlatformKey,
      sessionId: input.sessionId,
      userText,
      assistantText,
      sourceType: 'daily-log',
    });
  } catch (error) {
    console.warn(
      `[memory-plugin] cli daily-log write failed platform=${memoryPlatformKey} session=${input.sessionId}`,
      error,
    );
  }
}

function resolveMemoryPlatformKey(): string {
  const fromEnv = process.env.PULSE_CODER_MEMORY_PLATFORM_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const user = process.env.PULSE_CODER_MEMORY_USER?.trim()
    || process.env.USER?.trim()
    || process.env.LOGNAME?.trim()
    || DEFAULT_MEMORY_USER;
  return `cli:${user}`;
}
