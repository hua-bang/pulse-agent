# @pulse-coder/remote-server

HTTP server that wraps `pulse-coder-engine` and exposes it to messaging platforms. Incoming messages are dispatched to a per-channel agent session; responses stream back through the original platform's API.

## Tech Stack

- **Hono** + **@hono/node-server** — HTTP framework
- **tsup** — bundles to `dist/index.cjs`
- **tsx** — TypeScript watch mode for development
- `pulse-coder-engine`, `pulse-coder-memory-plugin`, `pulse-coder-plugin-kit`, `pulse-coder-acp`, `pulse-coder-langfuse-plugin` — workspace deps

## Endpoints

| Method | Path | Access |
|--------|------|--------|
| `GET` | `/health` | Public |
| `POST` | `/webhooks/feishu` | Public Feishu event webhook |
| `POST` | `/webhooks/discord` | Public (ED25519-verified) |
| `POST` | `/internal/agent/run` | Loopback + Bearer token |
| `GET` | `/internal/worktrees` | Loopback + Bearer token |
| `POST` | `/internal/worktrees` | Loopback + Bearer token |
| `GET` | `/internal/worktrees/:id` | Loopback + Bearer token |
| `POST` | `/internal/worktrees/:id/run` | Loopback + Bearer token |
| `DELETE` | `/internal/worktrees/:id` | Loopback + Bearer token |
| `GET` | `/internal/discord/gateway/status` | Loopback + Bearer token |
| `POST` | `/internal/discord/gateway/restart` | Loopback + Bearer token |
| `GET` | `/api/devtools/runs` | Local dev |

> Telegram and Web API adapters exist in code but are not mounted by default. `/internal/*` routes are loopback-only and require `INTERNAL_API_SECRET` in production.

## Dev & Build

```bash
# From repo root
pnpm --filter @pulse-coder/remote-server dev    # tsx watch
pnpm --filter @pulse-coder/remote-server build  # tsup → dist/index.cjs

# Or from this directory
npm run dev
npm run build
npm start                                        # node dist/index.cjs
```

## Configuration

Copy `.env.example` to `.env`. Key variables:

```bash
# === LLM ===
OPENAI_API_KEY=
OPENAI_API_URL=
OPENAI_MODEL=

# === Server ===
PORT=3000
HOST=0.0.0.0
INTERNAL_API_SECRET=          # Required in production

# === Feishu ===
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_ENCRYPT_KEY=
FEISHU_VERIFICATION_TOKEN=
FEISHU_EVENT_SOURCE=webhook  # webhook (default), long_connection, or both
FEISHU_ENABLE_REACTIONS=     # Optional: true, false, or group; default false
FEISHU_BOT_OPEN_ID=          # Optional fallback for group @bot filtering
FEISHU_BOT_USER_ID=          # Optional fallback for group @bot filtering
FEISHU_BOT_UNION_ID=         # Optional fallback for group @bot filtering
FEISHU_BOT_NAME=             # Optional fallback for group @bot filtering
FEISHU_BOT_MENTION_ALIASES=  # Optional comma-separated aliases for group @bot filtering

# === Discord ===
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=            # Required for DM / gateway mode
```

See `.env.example` for the full list including memory plugin, Gemini, Telegram, ACP, and compaction tuning.

### Model config

The active model is a single global `current_model` (not per-channel). It is resolved from the first existing config path, in order: `$PULSE_CODER_MODEL_CONFIG`, `.pulse-coder/config.json` in the cwd, or `~/.pulse-coder/config.json` in the home directory (`src/core/model-config.ts`). Use `/model <name>` to set it, `/model reset` to clear it, or `/model status` to inspect it.

### Langfuse observability

The `langfusePlugin` (`src/core/langfuse.ts`) is always mounted and auto-activates only when both keys are present; otherwise it disables itself safely. Runs are tagged `remote-server`.

```bash
LANGFUSE_PUBLIC_KEY=          # required to activate
LANGFUSE_SECRET_KEY=          # required to activate
# LANGFUSE_HOST=              # optional, defaults to Langfuse Cloud
# LANGFUSE_RELEASE=           # optional, git sha / version tag
```

## Slash Commands

Users can type these as in-channel text in any connected channel:

| Command | Description |
|---------|-------------|
| `/help` (`/start`, `/h`, `/?`) | Show command list |
| `/ping` | Health check reply |
| `/new` | Start a new session |
| `/clear` (`/reset`) | Clear current session context |
| `/compact` | Force context compaction |
| `/mode [status\|planning\|executing]` | View or switch agent mode |
| `/model [status\|reset\|<name>]` | View or switch the global LLM model |
| `/memory [on\|off\|pin <id>\|forget <id>]` | View or manage memory logs |
| `/current` (`/session`) | Show active session ID |
| `/detach` | Detach current session binding (keeps history) |
| `/resume` (`/sessions`, `/ls`) | List recent sessions or resume a specific one |
| `/fork <session-id>` (`/clone`) | Fork a session into a new branch |
| `/merge <session-id> [label]` (`/link`, `/unlink`) | Link or manage linked sessions |
| `/status` | Show current run status and session info |
| `/stop` (`/cancel`, `/halt`) | Abort the running agent turn |
| `/insight [days]` | Summarize recent session insights (default 7 days) |
| `/skills [list\|<name\|index> <message>]` | List or invoke a skill |
| `/soul [list\|status\|use <id>\|add <id>\|remove <id>\|clear]` | Manage persona injection |
| `/wt <status\|use\|clear>` | Git worktree binding |
| `/acp on <claude\|codex> [cwd]` | Switch to ACP agent mode |
| `/acp off` | Return to engine mode |
| `/restart [status\|update [branch]]` | Rebuild and restart (PM2 only) |

`//command` (double slash) forwards the command directly to a running ACP agent.

## Feishu Setup

1. In the Feishu Developer Console, create an app and note `App ID` / `App Secret`.
2. Subscribe to the event `im.message.receive_v1`.
3. Grant bot permissions: `im:message:send_as_bot`, `im:message.group_at_msg` (for group chats). Message reactions are optional; set `FEISHU_ENABLE_REACTIONS=true` or `group` only after granting reaction permissions.
4. Set `FEISHU_APP_ID` and `FEISHU_APP_SECRET` in `.env`. Group chats only trigger when the event mention is verified as the current bot. The server resolves bot identity through `/open-apis/bot/v3/info`; set `FEISHU_BOT_OPEN_ID`, `FEISHU_BOT_USER_ID`, `FEISHU_BOT_UNION_ID`, `FEISHU_BOT_NAME`, or `FEISHU_BOT_MENTION_ALIASES` as explicit fallbacks when needed.
5. Pick the event receiver:
   - `FEISHU_EVENT_SOURCE=long_connection`: use Feishu's persistent WebSocket connection. In the Feishu Developer Console, set event subscription mode to **Receive events through persistent connection**. The webhook route remains mounted but only returns an empty 200 response.
   - `FEISHU_EVENT_SOURCE=webhook`: use the public webhook endpoint. Set `FEISHU_ENCRYPT_KEY` and `FEISHU_VERIFICATION_TOKEN`, enable them in Event Subscription security settings, then set the webhook URL:
   ```
   https://your-server/webhooks/feishu
   ```
   - `FEISHU_EVENT_SOURCE=both`: start the long-connection client while keeping webhook ingestion active for migration. Duplicate events with the same `message_id` are ignored in-process.

## Discord Setup

### 1) Developer Portal

1. Copy the **Public Key** from your application settings.
2. Optional (requires HTTPS): set **Interactions Endpoint URL** to `https://your-server/webhooks/discord`.
3. In **Bot** settings, enable the **Message Content Intent** (privileged — required to read message text). The gateway also requests `GUILDS`, `GUILD_MESSAGES`, `GUILD_MESSAGE_REACTIONS`, `DIRECT_MESSAGES`, and `DIRECT_MESSAGE_REACTIONS` (non-privileged, granted by default); the two REACTIONS intents power the ❌-reaction cancel feature (`src/adapters/discord/gateway.ts`).

### 2) Environment Variables

```bash
DISCORD_PUBLIC_KEY=your_discord_public_key
DISCORD_BOT_TOKEN=your_discord_bot_token

# Optional:
# DISCORD_API_BASE_URL=https://discord.com/api/v10
# DISCORD_GATEWAY_URL=wss://gateway.discord.gg/?v=10&encoding=json
# DISCORD_PROXY_URL=http://127.0.0.1:7890
# DISCORD_DM_GATEWAY_ENABLED=true
# DISCORD_GUILD_REQUIRE_MENTION=true
# DISCORD_COMMAND_REGISTER_ENABLED=true
# DISCORD_COMMAND_GUILD_IDS=123456789,987654321   # faster dev registration
```

### 3) Usage

- **Guild channels** — mention the bot: `@YourBot explain this stack trace`. Set `DISCORD_GUILD_REQUIRE_MENTION=false` to allow plain text.
- **DMs** — send text directly; `/ask`, `/chat`, `/prompt` prefixes are normalized and stripped.
- **Application commands** — `/restart`, `/wt`, `/skills`, `/stop`, and the right-click message command **Ask Pulse** are auto-registered on startup (toggle with `DISCORD_COMMAND_REGISTER_ENABLED`). Other commands like `/new`, `/detach`, `/insight` work as in-channel text but are not registered as Discord application commands.

### 4) Gateway Internal Ops

```bash
# Check gateway health
curl -sS \
  -H "Authorization: Bearer $INTERNAL_API_SECRET" \
  http://127.0.0.1:3000/internal/discord/gateway/status

# Restart only the Discord gateway (no full process restart)
curl -sS -X POST \
  -H "Authorization: Bearer $INTERNAL_API_SECRET" \
  http://127.0.0.1:3000/internal/discord/gateway/restart
```

The included `scripts/discord-gateway-watchdog.sh` is a single health check meant to be run on a recurring schedule (e.g. cron). It queries the status endpoint, and after consecutive unhealthy checks (`DISCORD_GATEWAY_FAIL_THRESHOLD`, default 2) triggers a gateway restart; after repeated escalation cycles (`DISCORD_GATEWAY_MAX_ESCALATIONS`, default 3) it falls back to a full `pm2:restart` (`DISCORD_GATEWAY_ESCALATION_RESTART_COMMAND`).

## Internal Agent API

`POST /internal/agent/run` — loopback-only, requires `Authorization: Bearer $INTERNAL_API_SECRET`.

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INTERNAL_API_SECRET" \
  http://127.0.0.1:3000/internal/agent/run \
  -d '{"text": "summarize the latest news", "platformKey": "cron:daily-brief"}'
```

Key body fields:

| Field | Description |
|-------|-------------|
| `text` / `message` / `prompt` | User prompt (first non-empty wins) |
| `skill` | Invoke a named skill (`[use skill](name)` shorthand) |
| `platformKey` | Session namespace key (default: `internal:agent-run`) |
| `forceNewSession` | Start a fresh session (default: `true`) |
| `askPolicy` | Clarification behavior: `'never'` (default, auto-skip) or `'default'` (error if no default answer) |
| `caller` | Caller identity for PTC tool filtering |
| `callerSelectors` | Allowed caller tool names |
| `notify.feishu` | `{ receiveId, receiveIdType }` — post result to Feishu |
| `notify.discord` | `{ channelId, isThread }` — post result to Discord |

Response includes `result`, `toolCalls`, `compactions`, and `notify` fields.

## Worktree Internal API

Loopback-only, requires `Authorization: Bearer $INTERNAL_API_SECRET` (or `X-Internal-Api-Key`). Mounted at `/internal/worktrees*` via `src/routes/internal.ts`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/internal/worktrees` | List managed worktrees |
| `POST` | `/internal/worktrees` | Create or register a worktree |
| `GET` | `/internal/worktrees/:id` | Get a worktree by id |
| `POST` | `/internal/worktrees/:id/run` | Run a command inside a worktree |
| `DELETE` | `/internal/worktrees/:id` | Remove a worktree record (optionally its directory) |

Create body (`WorktreeCreateBody`): `id` (required), `repoRoot`, `worktreePath`, `branch`, `baseRef`, and optional `bind: { runtimeKey, scopeKey }`.

Run body (`WorktreeRunBody`): `backend` (`'host'` | `'docker'`, default `'host'`), `command` + `args` or `shell`, `timeoutMs`, `env`, and a `docker: { image, user, network, env, extraArgs }` block for the docker backend (image defaults to `PULSE_CODER_DOCKER_IMAGE` or `node:22-bookworm`).

## Custom Tools

Registered in `src/core/engine-singleton.ts`:

| Tool | Notes |
|------|-------|
| `analyze_image` | Analyze local images via OpenAI/GPT vision or Gemini (defer-loaded) |
| `cron_job` | Create/update a cron runner that calls `/internal/agent/run` (defer-loaded) |
| `deferred_demo` | Demo deferred tool that echoes a short message (defer-loaded) |
| `jina_ai_read` | Fetch readable page text via r.jina.ai, incl. login-walled pages (defer-loaded) |
| `lark_cli` | Run LarkSuite CLI for Feishu/Lark Open Platform operations (defer-loaded) |
| `read_linked_session` | Read messages from a session linked to the current one (defer-loaded) |
| `session_summary` | Summarize recent sessions by reading stored session messages (defer-loaded) |
| `twitter_list_tweets` | Fetch latest tweets from an X list via Nitter-compatible RSS feeds (defer-loaded) |
| `worktree_prepare` | Create or bind an isolated git worktree for the conversation |
| `worktree_run` | Run validation commands in the bound worktree (host or docker backend) |
| `ptc_demo_*` | PTC `allowed_callers` demos (`ptc_demo_caller_probe` is defer-loaded) |

Tools registered with `defer_loading: true` are not sent to the LLM until the `tool_search_tool_bm25` tool discovers them. `worktree_prepare`, `worktree_run`, and the restricted `ptc_demo_*` tools (except `ptc_demo_caller_probe`) are loaded eagerly.

## PTC `allowed_callers`

`allowed_callers` restricts which caller tool names can invoke a tool:

- `ptc_demo_caller_only` — only callable by `ptc_demo_caller_probe`
- `ptc_demo_cron_only` — only callable by `cron_job`
- `ptc_demo_deferred_only` — only callable by `deferred_demo`

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INTERNAL_API_SECRET" \
  http://127.0.0.1:3000/internal/agent/run \
  -d '{"text":"Call ptc_demo_caller_only with message=hello","caller":"ptc_demo_caller_probe","callerSelectors":["ptc_demo_caller_probe"]}'
```

## PM2 Deployment

```bash
npm i -g pm2

npm run pm2:start       # Build + start
npm run pm2:restart     # Rebuild + restart
npm run pm2:logs        # Stream logs
npm run pm2:stop
npm run pm2:delete
npm run pm2:save        # Persist process list across reboots

# Enable startup on reboot
pm2 startup && pm2 save
```

`ecosystem.config.cjs` runs `dist/index.cjs` in fork mode with autorestart and a memory guard.
