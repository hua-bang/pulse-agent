# remote-server in Docker

Run remote-server in an isolated container instead of directly on the host.

## Why

An agent run is a remote shell. The engine `bash` / `write` / `edit` tools and
`worktree_run` (`backend: "host"`) run as the server user and inherit its
environment. On a bare host that means every file the user can reach (SSH
keys, other checkouts, git credentials) and every secret in the process
environment. See `../../harness/knowledge/security-posture.md`.

The container limits the blast radius to one volume and the keys you give it:

| Control | Setting |
|---|---|
| Unprivileged user | runs as `node` (uid 1000), not root |
| Read-only code | `/app` is root-owned and the root filesystem is `read_only` |
| Writable state | only the `remote-server-home` volume (`/home/node`) and a `/tmp` tmpfs |
| Privileges | `cap_drop: ALL`, `no-new-privileges` |
| Resources | `mem_limit: 2g`, `cpus: 2`, `pids_limit: 512` |
| Network ingress | port bound to `127.0.0.1` only; Feishu uses `long_connection` |
| Host access | no bind mounts of host paths, no Docker socket |

The container does **not** hide secrets from the agent. Any key in
`remote-server.env` is readable by an agent run (`env`). Put only the keys this
service needs there, and prefer keys with spending limits.

## Run

From this directory:

```bash
cp ../../.env.example remote-server.env   # fill in secrets; git-ignored
docker compose up -d --build
docker compose logs -f
curl http://127.0.0.1:3000/health
```

Update to a new version:

```bash
git pull && docker compose up -d --build
```

Optional global CLIs (for example ACP agents for `/acp on claude|codex`) are
installed at build time:

```bash
REMOTE_SERVER_NPM_GLOBALS="@zed-industries/claude-agent-acp @zed-industries/codex-acp" \
  docker compose up -d --build
```

## Configuration notes

- `compose.yml` sets `NODE_ENV=production`, `HOST=0.0.0.0` (inside the
  container only), and `FEISHU_EVENT_SOURCE=long_connection`. These override
  `remote-server.env`. To use the Feishu webhook, change the compose file and
  put a reverse proxy in front of it.
- Set `INTERNAL_API_SECRET`. `NODE_ENV=production` makes it mandatory for
  `/internal/*`.
- A proxy on the host is reachable as `host.docker.internal`, for example
  `HTTPS_PROXY=http://host.docker.internal:7890` with `NODE_USE_ENV_PROXY=1`,
  or `DISCORD_PROXY_URL=http://host.docker.internal:7890`.
- Model config: `PULSE_CODER_MODEL_CONFIG` points to
  `~/.pulse-coder/config.json` in the volume, so `/model` can write it. A new
  volume is seeded from `apps/remote-server/.pulse-coder/config.json`; later
  image builds do not overwrite it.
- Worktree tools need a git repository. Clone one into the volume (for example
  `/home/node/repos/<name>`) and set `PULSE_CODER_REPO_ROOT` to it.

## What changes in a container

| Feature | Behavior |
|---|---|
| `/internal/*` from the host | Returns 403: traffic through the port mapping is not loopback. Call it from inside: `docker compose exec remote-server curl -H "Authorization: Bearer $INTERNAL_API_SECRET" http://127.0.0.1:3000/internal/discord/gateway/status` |
| `scripts/discord-gateway-watchdog.sh` | Run it with `docker compose exec`, or rely on `restart: unless-stopped` and the health check |
| `/restart` and `/restart update` | Not supported: there is no PM2 and `/app` is read-only. Update from the host with `git pull && docker compose up -d --build` |
| `cron_job` tool | Not supported: there is no cron daemon in the container |
| `worktree_run` with `backend: "docker"` | Not supported: the Docker socket is intentionally not mounted. `backend: "host"` runs inside the container |
| Devtools UI (`/devtools/*`) | Not included: `apps/devtools-web` is not built into the image. The JSON API still works on `127.0.0.1` |

## Reset state

```bash
docker compose down        # keeps the volume
docker compose down -v     # also deletes sessions, memory, and worktrees
```
