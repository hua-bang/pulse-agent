# Pulse telemetry gateway

A Cloudflare Worker between Pulse Canvas and the analytics backend.

```text
Pulse Canvas (main process) ──POST /v1/events──▶ this Worker ──▶ PostHog /batch/
                                                            └─▶ Analytics Engine (raw copy)
```

The client sends only to this Worker. To change the analytics backend, change `src/index.ts` and redeploy; no app release is needed.

## Deploy

1. Install Wrangler globally and sign in: `pnpm add --global wrangler@4`, then `wrangler login`.
2. `wrangler.toml` serves the Worker on `t.jasperhu.art`. `*.workers.dev` is often unreachable from mainland China, so keep a custom domain.
3. Set the PostHog project key: `wrangler secret put POSTHOG_API_KEY`. For an EU project, set `POSTHOG_HOST` to `https://eu.i.posthog.com`.
4. Deploy from this directory: `wrangler deploy`.
5. The deployed URL is `https://t.jasperhu.art/v1/events`, set as `DEFAULT_TELEMETRY_URL` in `apps/canvas-workspace/src/main/telemetry/ipc.ts`. Packaged builds send to it.

To test against a development launch, start Canvas with `PULSE_CANVAS_TELEMETRY_URL=<url>`. Development launches send nothing without it.

## Sinks and bindings

| Name | Kind | Effect when missing |
|---|---|---|
| `POSTHOG_API_KEY` | secret | No PostHog forwarding |
| `POSTHOG_HOST` | var | Uses `https://us.i.posthog.com` |
| `EVENTS` | Analytics Engine dataset | No raw copy |
| `RATE_LIMITER` | rate limit binding | No per-device limit |

Analytics Engine keeps data for about three months and samples at high volume, so count events with `sum(_sample_interval)`, not `count()`. One data point per event: `index1` is the device id; `blob1`..`blob6` are event, app version, platform, arch, session id, and props JSON; `double1` is the event time in ms and `double2` is 1 for packaged builds. Example query:

```sql
SELECT blob1 AS event, sum(_sample_interval) AS events, count(DISTINCT index1) AS sampled_devices
FROM pulse_canvas_events
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY event
```

## Wire format

`POST /v1/events`, JSON, at most 64 KB and 100 events:

```json
{
  "deviceId": "anonymous uuid",
  "sessionId": "uuid per app launch",
  "app": { "version": "0.1.80", "platform": "darwin", "arch": "arm64", "packaged": true },
  "events": [{ "event": "node_created", "ts": 1760000000000, "props": { "type": "text" } }]
}
```

Requests must use `content-type: application/json`. Responses: `204` accepted, `400` invalid batch, `404` other path, `405` other method, `413` too large, `415` other content type, `429` rate limited. Delivery to the sinks runs after the response, so `204` does not prove that a sink accepted the events; read `wrangler tail` for sink errors.
