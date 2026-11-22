# AGENTS.md - apps/vps-daemon

Local router for `@pulse-coder/vps-daemon`. Read root `AGENTS.md` and `harness/README.md` first.

## Role and ownership

This pnpm workspace owns the lightweight VPS daemon that exposes remote `@pulse-coder/storage` (SQLite WAL + `WorkspaceFiles` + SSE change stream) and remote runtime execution (persistent `node-pty` sessions + streaming JSONL CLI execution) for Pulse Canvas remote workspaces.

## Hard boundaries

- Bind to `127.0.0.1` by default; never expose unauthenticated `/v1/*` routes.
- Authenticate every `/v1/*` request with constant-time Bearer token comparison (`PULSE_VPS_TOKEN`).
- Confine `/v1/files` access strictly within the configured `dataDir` (reject path traversal).
- Reuse `@pulse-coder/storage` contracts directly; do not invent parallel database schemas.
- Keep PTY sessions independent of client disconnect (detach on SSE close; kill only on explicit kill).

## Validation

Use `harness/validate/validation.yaml`:

```bash
pnpm --filter @pulse-coder/vps-daemon typecheck
pnpm --filter @pulse-coder/vps-daemon test
pnpm --filter @pulse-coder/vps-daemon build
```
