# @pulse-coder/vps-daemon

Lightweight VPS daemon for remote Pulse Canvas workspaces. It exposes `@pulse-coder/storage` (SQLite WAL + `WorkspaceFiles` + SSE change stream), persistent `node-pty` terminals, and streaming JSONL CLI execution over HTTP/SSE.

## Quick start on your VPS

1. Build and run (listens on `127.0.0.1:4770` by default):

```bash
export PULSE_VPS_TOKEN="$(openssl rand -hex 24)"
export PULSE_VPS_DATA_DIR="$HOME/.pulse-coder/canvas"
export PULSE_VPS_WORKDIR="$HOME/projects"
pnpm --filter @pulse-coder/vps-daemon build
pnpm --filter @pulse-coder/vps-daemon start
```

2. Connect from your laptop using an SSH tunnel (no public port or HTTPS domain needed):

```bash
ssh -N -L 4770:127.0.0.1:4770 user@your-vps
```

Or configure the SSH host directly in `~/.pulse-coder/canvas/remote-workspaces.json` so Pulse Canvas opens the SSH tunnel automatically:

```json
{
  "workspaces": {
    "my-vps-ws": {
      "kind": "vps",
      "sshHost": "user@your-vps",
      "remotePort": 4770,
      "token": "<same PULSE_VPS_TOKEN>",
      "remoteWorkspaceId": "my-vps-ws",
      "cwd": "/home/dev/projects/my-app"
    }
  }
}
```

## Private deployment (without publishing to public npm)

You do **not** need to publish `@pulse-coder/vps-daemon` to npm:

- **Option 1 — Upload the 28 KB standalone bundle via `scp`** (recommended for minimal VPS footprint):
  1. Build locally: `pnpm --filter @pulse-coder/vps-daemon build`
  2. Copy `apps/vps-daemon/dist/index.cjs` to your VPS (e.g. `~/pulse-vps-daemon/index.cjs`).
  3. On the VPS, run `npm init -y && npm install better-sqlite3 node-pty` once inside `~/pulse-vps-daemon` (so native bindings match your VPS Linux arch), then run `node index.cjs`.
- **Option 2 — Private `git clone` over SSH**:
  Clone this private repo directly on the VPS with your deploy key, then run `pnpm --filter @pulse-coder/vps-daemon build && pnpm --filter @pulse-coder/vps-daemon start`.

## Optional backup to Google Drive / R2

Run `rclone` on a cron schedule against `$PULSE_VPS_DATA_DIR` (use SQLite backup or copy the backup snapshot, never a live WAL file directly).
