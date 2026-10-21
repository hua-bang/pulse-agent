/**
 * Validates the client wire format and maps it to sink formats.
 *
 * Client wire format (POST /v1/events, JSON):
 *   { deviceId, sessionId, app: { version, platform, arch, packaged },
 *     events: [{ event, ts, props }] }
 *
 * Invalid events are dropped one by one. A batch without a valid id, app
 * block, or event is rejected as a whole.
 */

export type PropValue = string | number | boolean;

export interface TelemetryEvent {
  event: string;
  ts: number;
  props: Record<string, PropValue>;
}

export interface TelemetryBatch {
  deviceId: string;
  sessionId: string;
  app: {
    version: string;
    platform: string;
    arch: string;
    packaged: boolean;
  };
  events: TelemetryEvent[];
}

export const MAX_EVENTS = 100;
const MAX_PROPS = 16;
const MAX_STRING = 200;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const EVENT_NAME = /^[a-z][a-z0-9_.]{0,63}$/;
const PROP_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const APP_FIELD = /^[A-Za-z0-9._-]{1,32}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

function parseProps(value: unknown): Record<string, PropValue> {
  if (!isRecord(value)) return {};
  const out: Record<string, PropValue> = {};
  for (const [key, prop] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (!PROP_KEY.test(key)) continue;
    if (typeof prop === 'string') out[key] = prop.slice(0, MAX_STRING);
    else if (typeof prop === 'boolean') out[key] = prop;
    else if (typeof prop === 'number' && Number.isFinite(prop)) out[key] = prop;
  }
  return out;
}

function parseEvent(value: unknown, now: number): TelemetryEvent | null {
  if (!isRecord(value)) return null;
  if (typeof value.event !== 'string' || !EVENT_NAME.test(value.event)) return null;
  // A client clock far off is not trusted; the receive time replaces it.
  const ts = typeof value.ts === 'number' && Math.abs(value.ts - now) < 7 * 24 * 3600_000
    ? value.ts
    : now;
  return { event: value.event, ts, props: parseProps(value.props) };
}

export function parseBatch(value: unknown, now: number): TelemetryBatch | null {
  if (!isRecord(value) || !isRecord(value.app)) return null;
  const { deviceId, sessionId, app } = value;
  if (typeof deviceId !== 'string' || !ID.test(deviceId)) return null;
  if (typeof sessionId !== 'string' || !ID.test(sessionId)) return null;
  const { version, platform, arch, packaged } = app;
  if (typeof version !== 'string' || !APP_FIELD.test(version)) return null;
  if (typeof platform !== 'string' || !APP_FIELD.test(platform)) return null;
  if (typeof arch !== 'string' || !APP_FIELD.test(arch)) return null;
  if (!Array.isArray(value.events)) return null;

  const events = value.events
    .slice(0, MAX_EVENTS)
    .map(event => parseEvent(event, now))
    .filter((event): event is TelemetryEvent => event !== null);
  if (events.length === 0) return null;

  return {
    deviceId,
    sessionId,
    app: { version, platform, arch, packaged: packaged === true },
    events,
  };
}

const POSTHOG_OS: Record<string, string> = {
  darwin: 'Mac OS X',
  win32: 'Windows',
  linux: 'Linux',
};

/** PostHog `/batch/` body. `ip` feeds PostHog GeoIP. */
export function toPostHogBatch(batch: TelemetryBatch, apiKey: string, ip?: string) {
  return {
    api_key: apiKey,
    batch: batch.events.map(event => ({
      event: event.event,
      distinct_id: batch.deviceId,
      timestamp: new Date(event.ts).toISOString(),
      properties: {
        ...event.props,
        // Anonymous events: no PostHog person profile per installation.
        $process_person_profile: false,
        $session_id: batch.sessionId,
        $lib: 'pulse-telemetry-gateway',
        $os: POSTHOG_OS[batch.app.platform] ?? batch.app.platform,
        ...(ip ? { $ip: ip } : {}),
        app_version: batch.app.version,
        arch: batch.app.arch,
        packaged: batch.app.packaged,
      },
    })),
  };
}

/** One Analytics Engine data point per event. */
export function toAnalyticsDataPoints(batch: TelemetryBatch) {
  return batch.events.map(event => ({
    indexes: [batch.deviceId],
    blobs: [
      event.event,
      batch.app.version,
      batch.app.platform,
      batch.app.arch,
      batch.sessionId,
      JSON.stringify(event.props),
    ],
    doubles: [event.ts, batch.app.packaged ? 1 : 0],
  }));
}
