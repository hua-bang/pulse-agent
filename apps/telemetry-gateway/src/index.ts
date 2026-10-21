/**
 * Pulse telemetry gateway (Cloudflare Worker).
 *
 * Route: POST /v1/events → 204. The request is validated and rate limited
 * here; delivery to the sinks runs after the response (ctx.waitUntil).
 *
 * Sinks, each active only when configured:
 *   - PostHog: secret POSTHOG_API_KEY, optional var POSTHOG_HOST.
 *   - Analytics Engine: dataset binding EVENTS (raw copy, SQL access).
 * Optional RATE_LIMITER binding limits requests per device id.
 *
 * Clients only know this URL, so a sink can change without a client release.
 */

import {
  parseBatch,
  toAnalyticsDataPoints,
  toPostHogBatch,
  type TelemetryBatch,
} from './batch';

interface AnalyticsEngineDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Env {
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
  EVENTS?: AnalyticsEngineDataset;
  RATE_LIMITER?: RateLimiter;
}

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

let warnedMissingKey = false;

const status = (code: number, headers?: Record<string, string>) => (
  new Response(null, { status: code, headers })
);

async function deliver(batch: TelemetryBatch, env: Env, ip: string | undefined): Promise<void> {
  if (env.EVENTS) {
    try {
      for (const point of toAnalyticsDataPoints(batch)) env.EVENTS.writeDataPoint(point);
    } catch (error) {
      console.error('analytics engine write failed', error);
    }
  }

  const apiKey = env.POSTHOG_API_KEY?.trim();
  if (!apiKey) {
    // Once per isolate: a missing secret is otherwise invisible behind the 204.
    if (!warnedMissingKey) console.warn('POSTHOG_API_KEY is not set; PostHog forwarding is off');
    warnedMissingKey = true;
    return;
  }
  const host = (env.POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST).replace(/\/+$/, '');
  try {
    const response = await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toPostHogBatch(batch, apiKey, ip)),
    });
    if (!response.ok) console.error('posthog batch failed', response.status);
  } catch (error) {
    console.error('posthog batch failed', error);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/v1/events') return status(404);
    if (request.method !== 'POST') return status(405, { allow: 'POST' });
    // A JSON content type forces a CORS preflight, so web pages cannot post here.
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^application\/json\s*(;|$)/i.test(contentType)) return status(415);
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return status(413);

    // Measure wire bytes: a chunked request has no content-length.
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) return status(413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return status(400);
    }
    const batch = parseBatch(parsed, Date.now());
    if (!batch) return status(400);

    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: batch.deviceId });
      if (!success) return status(429);
    }

    ctx.waitUntil(deliver(batch, env, request.headers.get('cf-connecting-ip') ?? undefined));
    return status(204);
  },
};
