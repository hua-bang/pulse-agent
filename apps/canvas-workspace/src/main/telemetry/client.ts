/**
 * Batching telemetry client for the Pulse telemetry gateway.
 *
 * Wire format (POST <endpoint>, JSON):
 *   { deviceId, sessionId, app: { version, platform, arch, packaged },
 *     events: [{ event, ts, props }] }
 *
 * The client never blocks the app: events queue in memory, flush on a timer
 * or when the batch is full, and a failed or timed-out send drops the batch.
 * The user setting, the notice flag, and the anonymous device id persist in
 * one small JSON file.
 *
 * Nothing leaves the device before the user has seen the first-launch
 * notice: events queue until the user makes a choice (`setEnabled`), then
 * the queue sends, or clears on opt-out. Without a choice, the queue is
 * dropped at quit.
 */

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import {
  TELEMETRY_EVENTS,
  type TelemetryPropValue,
  type TelemetryStatus,
} from '../../shared/api/telemetry';

export interface TelemetryAppInfo {
  version: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

type Props = Record<string, TelemetryPropValue>;

interface TelemetryEventRecord {
  event: string;
  ts: number;
  props: Props;
}

interface TelemetrySettings {
  enabled: boolean;
  deviceId: string;
  /** The user saw the notice and chose; until then nothing is sent. */
  noticeSeen: boolean;
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
/** The gateway accepts at most this many events per request. */
const MAX_BATCH = 100;
const MAX_STRING = 200;
/** A hung gateway must not block the send chain for the rest of the run. */
const SEND_TIMEOUT_MS = 10_000;
const ALLOWED_PROPS: Record<string, readonly string[]> = TELEMETRY_EVENTS;

/** Keep only the event's listed prop keys with short primitive values. */
export function sanitizeTelemetryProps(event: string, props: unknown): Props {
  const allowed = Object.prototype.hasOwnProperty.call(ALLOWED_PROPS, event) ? ALLOWED_PROPS[event] : [];
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  const out: Props = {};
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (!allowed.includes(key)) continue;
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
  private newDevice = false;

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
    return {
      configured: this.configured,
      enabled: settings.enabled,
      noticeSeen: settings.noticeSeen,
    };
  }

  /** True when this run generated the device id: the first launch here. */
  async isFirstLaunch(): Promise<boolean> {
    await this.loadSettings();
    return this.newDevice;
  }

  /**
   * The user's choice, from the first-launch notice or Settings; it also
   * marks the notice as seen. Persists first; a failed write rejects and
   * leaves the settings unchanged. Turning it on sends the held queue.
   */
  async setEnabled(enabled: boolean): Promise<TelemetryStatus> {
    const settings = await this.loadSettings();
    await this.writeSettings({ ...settings, enabled, noticeSeen: true });
    settings.enabled = enabled;
    settings.noticeSeen = true;
    if (enabled) {
      if (this.queue.length > 0) void this.flush();
    } else {
      this.queue = [];
    }
    return this.status();
  }

  /** Queue one event. Unknown names and an unconfigured build are no-ops. */
  async track(event: string, props?: unknown): Promise<void> {
    if (!this.configured || !Object.prototype.hasOwnProperty.call(ALLOWED_PROPS, event)) return;
    const settings = await this.loadSettings();
    if (!settings.enabled) return;
    this.queue.push({
      event,
      ts: this.options.now(),
      props: sanitizeTelemetryProps(event, props),
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
    // Hold the queue until the user has seen the notice.
    if (!(await this.loadSettings()).noticeSeen) return;
    while (this.queue.length > 0) {
      await this.sendBatch(this.queue.splice(0, MAX_BATCH));
    }
  }

  private async sendBatch(events: TelemetryEventRecord[]): Promise<void> {
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
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
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
      noticeSeen: stored.noticeSeen === true,
    };
    this.newDevice = settings.deviceId !== stored.deviceId;
    // An unconfigured build writes nothing to disk.
    if (this.configured && this.newDevice) await this.saveSettings(settings);
    return settings;
  }

  private async saveSettings(settings: TelemetrySettings): Promise<void> {
    try {
      await this.writeSettings(settings);
    } catch {
      // A read-only home keeps the generated device id for this run only.
    }
  }

  private async writeSettings(settings: TelemetrySettings): Promise<void> {
    await fs.mkdir(dirname(this.options.settingsPath), { recursive: true });
    await fs.writeFile(this.options.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  }
}
