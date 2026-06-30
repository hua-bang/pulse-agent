# Remote Server Runbook

## Scope

This runbook covers local operation and smoke testing for `apps/remote-server`. For architecture details, start with `AGENTS.md` and `CLAUDE.md`.

## Start Locally

From the repository root:

```bash
pnpm --filter @pulse-coder/remote-server dev
```

Build and run compiled output:

```bash
pnpm --filter @pulse-coder/remote-server build
pnpm --filter @pulse-coder/remote-server start
```

## Required Configuration

Use local `.env` files for secrets. Do not commit secrets.

Minimum runtime configuration depends on the platform being exercised:

- LLM provider key/model (`OPENAI_*` or `ANTHROPIC_*`).
- Platform credentials for Feishu or Discord when testing webhooks.
- `INTERNAL_API_SECRET` for `/internal/*` automation routes.

Model overrides are read from `.pulse-coder/config.json` or `$PULSE_CODER_MODEL_CONFIG`; this is runtime config, not repository harness source of truth.

## Feishu Event Receiver

`FEISHU_EVENT_SOURCE` controls how Feishu events enter the process:

- `webhook` (default): Feishu posts events to `/webhooks/feishu`.
- `long_connection`: the process starts the Feishu SDK `WSClient` and receives events over a persistent WebSocket connection; `/webhooks/feishu` stays mounted but only returns an empty 200 response.
- `both`: both receivers are enabled for migration; duplicate `message_id` values are ignored in-process.

When using `long_connection`, set the Feishu Developer Console event subscription mode to persistent connection. The process needs outbound network access to Feishu, but no public inbound webhook URL. Feishu long-connection delivery is clustered, so only run one active receiver per app unless random distribution across instances is acceptable.

## Smoke Checks

### Health

```bash
curl http://127.0.0.1:<port>/health
```

### Internal Agent Run

Use only from loopback with bearer token:

```bash
curl -X POST http://127.0.0.1:<port>/internal/agent/run \
  -H "Authorization: Bearer $INTERNAL_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

Adjust payload to match `src/routes/internal.ts`.

## Operational Boundaries

- `/internal/*` routes must require loopback IP and bearer token.
- Platform webhooks should ack quickly before long-running agent work.
- Feishu long-connection handlers should return quickly; parsed messages must still enter the shared dispatcher asynchronously.
- Per-platform concurrency guard should remain active.
- Session, memory, and worktree state are stored under user-level `~/.pulse-coder/*` directories.
- Adapter `StreamHandle` callbacks own platform-specific output behavior.

## Evidence To Capture

For runtime changes, include:

- command used to start the server
- endpoint or webhook path tested
- response status/body summary
- relevant log excerpt if failure occurs
- skipped platform checks and why
