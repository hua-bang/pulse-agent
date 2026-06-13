/**
 * Process-wide singleton wrapper around the memory plugin's service.
 *
 * `vectors.sqlite` is a single file, so every Canvas agent (per workspace +
 * global chat) must share one `FileMemoryPluginService` instance. Init is lazy
 * and idempotent. embedding provider defaults to the offline hash provider;
 * setting MEMORY_EMBEDDING_API_KEY (etc.) switches it to OpenAI automatically.
 */

import { homedir } from 'os';
import { join } from 'path';
import {
  createMemoryIntegrationFromEnv,
  type FileMemoryPluginService,
} from 'pulse-coder-memory-plugin';

type MemoryIntegration = ReturnType<typeof createMemoryIntegrationFromEnv>;

let integration: MemoryIntegration | null = null;
let initPromise: Promise<void> | null = null;
let testOverride: FileMemoryPluginService | null = null;

/** Storage root for canvas chat memory (alongside the rest of canvas state). */
export function canvasMemoryBaseDir(): string {
  return join(homedir(), '.pulse-coder', 'canvas', 'memory');
}

function getIntegration(): MemoryIntegration {
  if (!integration) {
    integration = createMemoryIntegrationFromEnv({
      env: process.env,
      baseDir: canvasMemoryBaseDir(),
      pluginName: 'canvas-memory',
      pluginVersion: '0.0.1',
    });
  }
  return integration;
}

/** Initialize the shared service once. Safe to call repeatedly / concurrently. */
export function ensureCanvasMemory(): Promise<void> {
  if (!initPromise) {
    initPromise = getIntegration()
      .initialize()
      .catch((err) => {
        initPromise = null; // allow a later retry
        throw err;
      });
  }
  return initPromise;
}

export async function getCanvasMemoryService(): Promise<FileMemoryPluginService> {
  if (testOverride) return testOverride;
  await ensureCanvasMemory();
  return getIntegration().service;
}

/** Test hook: inject a service bound to a temp baseDir. Pass null to reset. */
export function __setCanvasMemoryServiceForTest(service: FileMemoryPluginService | null): void {
  testOverride = service;
}
