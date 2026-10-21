/**
 * Batching telemetry client for the Pulse telemetry gateway.
 *
 * Wire format (POST <endpoint>, JSON):
 *   { deviceId, sessionId, app: { version, platform, arch, packaged },
 *     events: [{ event, ts, props }] }
 *
 * The client never blocks the app: events queue in memory, flush on a timer
 * or when the batch is full, and a failed send drops the batch. The user
 * setting and the anonymous device id persist in one small JSON file.
 */

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import {
  TELEMETRY_EVENTS,
  type TelemetryProps,
  type TelemetryStatus,
} from '../../shared/api/telemetry';

export interface TelemetryAppInfo {
  version: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

interface TelemetryEventRecord {
  event: string;
  ts: number;
  props: TelemetryProps;
}

interface TelemetrySettings {
  enabled: boolean;
  deviceId: string;
}

export interface TelemetryClientOptions {
  /** Gateway URL. Empty means this build sends nothing. */
  endpoint: string;
  /** JSON file that stores `{ enabled, deviceId }`. */
  settingsPath: string;
  app: TelemetryAppInfo;
  fetch?: typeof fetch;
  now?: () => number;
  flushIntervalMs?: number;
  /** Flush as soon as the queue reaches this size. */
  batchSize?: number;
}

const MAX_QUEUE = 200;
const MAX_PROPS = 16;
const MAX_STRING = 200;
const PROP_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const KNOWN_EVENTS = new Set<string>(TELEMETRY_EVENTS);

/** Keep only short primitive props with plain keys. */
export function sanitizeTelemetryProps(props: unknown): TelemetryProps {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  const out: TelemetryProps = {};
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (!PROP_KEY.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, MAX_STRING);
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

export class TelemetryClient {
  private readonly options: Required<Omit<TelemetryClientOptions, 'fetch'>> & {
    fetch: typeof fetch;
  };
  private readonly sessionId = randomUUID();
  private queue: TelemetryEventRecord[] = [];
  private settings: Promise<TelemetrySettings> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(options: TelemetryClientOptions) {
    this.options = {
      ...options,
      fetch: options.fetch ?? fetch,
      now: options.now ?? Date.now,
      flushIntervalMs: options.flushIntervalMs ?? 30_000,
      batchSize: options.batchSize ?? 20,
    };
  }

  get configured(): boolean {
    return this.options.endpoint.length > 0;
  }

  async status(): Promise<TelemetryStatus> {
    const settings = await this.loadSettings();
    return { configured: this.configured, enabled: settings.enabled };
  }

  async setEnabled(enabled: boolean): Promise<TelemetryStatus> {
    const settings = await this.loadSettings();
    settings.enabled = enabled;
    if (!enabled) this.queue = [];
    await this.saveSettings(settings);
    return this.status();
  }

  /** Queue one event. Unknown names and an unconfigured build are no-ops. */
  async track(event: string, props?: unknown): Promise<void> {
    if (!this.configured || !KNOWN_EVENTS.has(event)) return;
    const settings = await this.loadSettings();
    if (!settings.enabled) return;
    this.queue.push({
      event,
      ts: this.options.now(),
      props: sanitizeTelemetryProps(props),
    });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= this.options.batchSize) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /** Send everything queued now. Never throws. */
  flush(): Promise<void> {
    this.clearTimer();
    this.inFlight = this.inFlight.then(() => this.sendQueued());
    return this.inFlight;
  }

  /** Flush once, bounded by `timeoutMs`, for app quit. */
  async shutdown(timeoutMs = 1_500): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      this.flush(),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, timeoutMs); }),
    ]);
    if (timeout) clearTimeout(timeout);
  }

  private async sendQueued(): Promise<void> {
    if (this.queue.length === 0) return;
    const events = this.queue;
    this.queue = [];
    try {
      const settings = await this.loadSettings();
      if (!settings.enabled) return;
      await this.options.fetch(this.options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deviceId: settings.deviceId,
          sessionId: this.sessionId,
          app: this.options.app,
          events,
        }),
      });
    } catch {
      // Telemetry is best effort: a failed batch is dropped, not retried.
    }
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.options.flushIntervalMs);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private loadSettings(): Promise<TelemetrySettings> {
    this.settings ??= this.readSettings();
    return this.settings;
  }

  private async readSettings(): Promise<TelemetrySettings> {
    let stored: Partial<TelemetrySettings> = {};
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.options.settingsPath, 'utf8'));
      if (parsed && typeof parsed === 'object') stored = parsed as Partial<TelemetrySettings>;
    } catch {
      // Missing or unreadable file: start from defaults.
    }
    const settings: TelemetrySettings = {
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : true,
      deviceId: typeof stored.deviceId === 'string' && stored.deviceId ? stored.deviceId : randomUUID(),
    };
    // An unconfigured build writes nothing to disk.
    if (this.configured && settings.deviceId !== stored.deviceId) await this.saveSettings(settings);
    return settings;
  }

  private async saveSettings(settings: TelemetrySettings): Promise<void> {
    try {
      await fs.mkdir(dirname(this.options.settingsPath), { recursive: true });
      await fs.writeFile(this.options.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    } catch {
      // A read-only home keeps the in-memory value for this run.
    }
  }
}
