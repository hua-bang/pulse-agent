# @pulse-coder/remote-server

HTTP server that wraps `pulse-coder-engine` and exposes it to messaging platforms. Incoming messages are dispatched to a per-channel agent session; responses stream back through the original platform's API.

## Tech Stack

- **Hono** + **@hono/node-server** — HTTP framework
- **tsup** — bundles to `dist/index.cjs`
- **tsx** — TypeScript watch mode for development
- `pulse-coder-engine`, `pulse-coder-memory-plugin`, `pulse-coder-plugin-kit`, `pulse-coder-acp` — workspace deps

## Endpoints

| Method | Path | Access |
|--------|------|--------|
| `GET` | `/health` | Public |
| `POST` | `/webhooks/feishu` | Public (HMAC-verified) |
| `POST` | `/webhooks/discord` | Public (ED25519-verified) |
| `POST` | `/internal/agent/run` | Loopback + Bearer token |
| `GET` | `/internal/discord/gateway/status` | Loopback + Bearer token |
| `POST` | `/internal/discord/gateway/restart` | Loopback + Bearer token |
| `GET` | `/api/devtools/runs` | Local dev |

> Telegram and Web API adapters exist in code but are not mounted by default.

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

# === Discord ===
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=            # Required for DM / gateway mode
```

See `.env.example` for the full list including memory plugin, Gemini, Telegram, ACP, and compaction tuning.

Model overrides per-channel can be set in `.pulse-coder/config.json` (cwd) or via `$PULSE_CODER_MODEL_CONFIG`.

## Slash Commands

Users can type these in any connected channel:

| Command | Description |
|---------|-------------|
| `/new` | Start a new session (clear history) |
| `/clear` | Alias for `/new` |
| `/resume [id]` | List recent sessions or resume a specific one |
| `/fork` | Fork current session into a new branch |
| `/merge` | Merge a linked session |
| `/status` | Show current run status |
| `/current` | Show active session ID |
| `/stop` | Abort the running agent turn |
| `/compact` | Manually trigger context compaction |
| `/memory [show\|clear]` | View or clear memory logs |
| `/model <name>` | Override LLM model for this channel |
| `/mode <plan\|act>` | Switch agent mode |
| `/soul [name]` | Set or clear persona injection |
| `/skills [list\|install]` | Manage skills |
| `/wt <bind\|unbind\|status>` | Git worktree binding |
| `/acp on <claude\|codex>` | Switch to ACP agent mode |
| `/acp off` | Return to engine mode |
| `/restart` | Rebuild and restart (PM2 only) |
| `/ping` | Health check reply |
| `/help` | Show command list |

`//command` (double slash) forwards the command directly to a running ACP agent.

## Feishu Setup

1. In the Feishu Developer Console, create an app and note `App ID` / `App Secret`.
2. Enable **Encrypt Key** and **Verification Token** (Event Subscription → Security Settings).
3. Set the webhook URL:
   ```
   https://your-server/webhooks/feishu
   ```
4. Subscribe to the event `im.message.receive_v1`.
5. Grant bot permissions: `im:message:send_as_bot`, `im:message.group_at_msg` (for group chats).
6. Set `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_ENCRYPT_KEY`, `FEISHU_VERIFICATION_TOKEN` in `.env`.

## Discord Setup

### 1) Developer Portal

1. Copy the **Public Key** from your application settings.
2. Optional (requires HTTPS): set **Interactions Endpoint URL** to `https://your-server/webhooks/discord`.
3. In **Bot** settings, enable intents: `Direct Messages`, `Server Messages`, `Message Content Intent`.

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
- **Slash commands** — `/ask <text>` and management commands (`/restart`, `/new`, etc.) are auto-registered on startup.

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

The included `scripts/discord-gateway-watchdog.sh` polls this endpoint every ~90 s and triggers a restart after consecutive unhealthy checks.

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
| `caller` | Caller identity for PTC tool filtering |
| `callerSelectors` | Allowed caller tool names |
| `notify.feishu` | `{ receiveId, receiveIdType }` — post result to Feishu |
| `notify.discord` | `{ channelId, isThread }` — post result to Discord |

Response includes `result`, `toolCalls`, `compactions`, and `notify` fields.

## Custom Tools

Registered in `src/core/engine-singleton.ts`:

| Tool | Notes |
|------|-------|
| `cron_job` | Schedules recurring internal agent runs |
| `twitter_list_tweets` | Fetches X/Twitter list via Nitter RSS with fallback instances |
| `jina_ai_read` | Web page reader via Jina AI |
| `session_summary` | Summarizes a stored session |
| `deferred_demo` | `defer_loading: true` demo — discovered only via tool search |
| `ptc_demo_*` | PTC `allowed_callers` demos |

`defer_loading: true` tools are not sent to the LLM until the `tool_search_tool_bm25` tool discovers them.

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
