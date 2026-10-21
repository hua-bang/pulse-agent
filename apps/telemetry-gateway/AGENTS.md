# AGENTS.md - apps/telemetry-gateway

Local entry for the Pulse telemetry gateway. Read root AGENTS and `../../harness/README.md` first. CLAUDE.md is a thin import shell; edit this file.

## Role and ownership

This workspace owns one Cloudflare Worker. It receives anonymous usage batches from Pulse Canvas, validates and rate limits them, and forwards them to the configured sinks (PostHog, Analytics Engine). The Canvas client lives in `../canvas-workspace/src/main/telemetry/`; the event list lives in `../canvas-workspace/src/shared/api/telemetry.ts`.

## Task routes

| Task | Read |
|---|---|
| Wire format, validation, sink mapping | `src/batch.ts` |
| Route, bindings, delivery | `src/index.ts`, `wrangler.toml` |
| Deploy and configure | `README.md` |

## Local constraints

- The wire format is a contract with released Canvas builds. Add fields as optional; never rename or remove one that a released client sends.
- Clients know only this Worker's URL. Change sinks here, not in the client.
- Keep the Worker free of runtime dependencies. Wrangler is a global CLI, not a workspace dependency.
- Secrets (the PostHog key) go through `wrangler secret put`, never `wrangler.toml` or source.
- Never forward free text from the client beyond the sanitized props: no conversation text, paths, or URLs reach a sink.

## Validation

```bash
pnpm --filter @pulse-coder/telemetry-gateway test
pnpm --filter @pulse-coder/telemetry-gateway typecheck
```

Tests call the Worker handler with fake bindings and a stubbed `fetch`. They do not prove the real bindings in `wrangler.toml`; check those with `wrangler deploy --dry-run` or a live deploy.
