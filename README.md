# Pulse Agent

Plugin-first coding agent monorepo with a reusable engine, an interactive CLI, multi-agent orchestration, and optional server/runtime integrations.

## Language
- English docs (this file)
- Chinese docs: [`README-CN.md`](./README-CN.md)

## Repository layout

This repo is a `pnpm` workspace monorepo (`packages/*`, `apps/*`).

### Packages

| Path | npm name | Purpose |
| --- | --- | --- |
| `packages/engine` | `pulse-coder-engine` | Core runtime: loop, hooks, built-in tools, plugin manager |
| `packages/cli` | `pulse-coder-cli` | Interactive terminal app built on top of the engine |
| `packages/pulse-sandbox` | `pulse-sandbox` | Sandboxed JavaScript executor and `run_js` tool adapter |
| `packages/memory-plugin` | `pulse-coder-memory-plugin` | Host-side memory plugin and integration helpers |
| `packages/plugin-kit` | `pulse-coder-plugin-kit` | Shared utilities for plugins (worktree helpers, vault, devtools) |
| `packages/orchestrator` | `pulse-coder-orchestrator` | Multi-agent orchestration (TaskGraph, planner, scheduler, runner, aggregator) |
| `packages/agent-teams` | `pulse-coder-agent-teams` | Agent teams coordination built on the orchestrator |
| `packages/acp` | `pulse-coder-acp` | Agent Context Protocol — typed client, runner, and state store |
| `packages/langfuse-plugin` | `pulse-coder-langfuse-plugin` | Optional Langfuse tracing plugin |
| `packages/canvas-cli` | `@pulse-coder/canvas-cli` | Canvas-related CLI helpers |
| `packages/canvas-nodes` | `@pulse-canvas/nodes` | External Pulse Canvas node plugins (runtime-loadable plugin directories) |

### Apps

| Path | Purpose |
| --- | --- |
| `apps/remote-server` | HTTP service wrapping the engine (Feishu/Discord/Telegram adapters) |
| `apps/teams-cli` | CLI for multi-agent teams workflows |
| `apps/canvas-workspace` | Canvas-based workspace app (Electron) |
| `apps/coder-demo` | Legacy experimental app |
| `apps/devtools-web` | Experimental devtools web UI |
| `apps/canvas-plugin-react-mf-note-demo` | Experimental Pulse Canvas note-plugin demo |

> Experimental apps (`apps/coder-demo`, `apps/devtools-web`, `apps/canvas-plugin-react-mf-note-demo`) live in the repo but are excluded from the default workspace install/build. The active workspace set is defined in `pnpm-workspace.yaml` (SSOT).

Other notable folders: `docs/`, `architecture/`, `examples/`, `scripts/`.

---

## Architecture

### 1) Engine bootstrap
`Engine.initialize()` (`packages/engine/src/Engine.ts`) creates a `PluginManager`, loads built-in plugins by default, then merges tools in this order:
1. built-in tools,
2. plugin-registered tools,
3. user-supplied tools (`EngineOptions.tools`, highest priority).

### 2) Plugin system
Two plugin tracks are supported:
- **Engine plugins**: runtime code plugins with lifecycle + hooks.
- **User config plugins**: scanned config files (`config.{json|yaml|yml}`).

Engine plugin scan paths:
- `.pulse-coder/engine-plugins`
- `.coder/engine-plugins` (legacy)
- `~/.pulse-coder/engine-plugins`
- `~/.coder/engine-plugins`

A plugin implements `EnginePlugin` from `pulse-coder-engine`. Its `initialize(ctx)` receives a context with:
- `ctx.registerTool(name, tool)` / `ctx.registerTools(map)`,
- `ctx.registerHook(hookName, handler)` for any hook in `EngineHookMap`,
- `ctx.registerService(name, service)` / `ctx.getService(name)`,
- `ctx.getConfig(key)` / `ctx.setConfig(key, val)`,
- `ctx.events` (EventEmitter) and `ctx.logger`.

### 3) Agent loop behavior
Core loop (`packages/engine/src/core/loop.ts`) provides:
- streaming text/tool events,
- LLM hooks (`beforeLLMCall`, `afterLLMCall`),
- tool hooks (`beforeToolCall`, `afterToolCall`, `onToolCall`),
- retry with exponential backoff for retryable failures (`429/5xx`),
- abort handling,
- automatic context compaction (`onCompacted`).

Run-level hooks (`beforeRun`, `afterRun`) fire in `Engine.run()` (`packages/engine/src/Engine.ts`); `beforeRun` can mutate `systemPrompt` and `tools`.

### 4) Built-in plugins
Registered from `packages/engine/src/built-in/index.ts` (in load order):
- `built-in-mcp`: loads MCP servers from `.pulse-coder/mcp.json` (or legacy `.coder/mcp.json`) and exposes tools as `mcp_<server>_<tool>`.
- `built-in-skills`: scans `SKILL.md` files and exposes the `skill` tool.
- `tool-search`: deferred tool discovery (loads tool schemas on demand).
- `built-in-plan-mode`: planning/executing mode management.
- `built-in-task-tracking`: `task_create/task_get/task_list/task_update` with local persistence.
- `SubAgentPlugin`: loads Markdown agent definitions from `.pulse-coder/agents/*.md` and registers `<name>_agent` tools.
- `agent-teams`: exposes orchestrator-driven multi-agent coordination as engine tools.
- `role-soul`: persona / system-prompt injection.
- `ptc`: PTC workflow integration.

### 5) CLI runtime model
`pulse-coder-cli` adds:
- session persistence under `~/.pulse-coder/sessions`,
- per-session task-list binding,
- one-shot skill command transformation (`/skills ...`),
- `Esc` abort for in-flight responses,
- clarification flow via the `clarify` tool,
- built-in `run_js` tool from `pulse-sandbox`.

### 6) Orchestrator (`packages/orchestrator`)
Runs a **TaskGraph** — a DAG of `TaskNode` objects with `{ id, role, deps[], input?, agent?, instruction? }`.

Routing strategies (`OrchestrationInput.route`):
- `'auto'` — keyword-based role selection,
- `'all'` — every registered role runs,
- `'plan'` — LLM dynamically builds the graph.

Built-in roles: `researcher`, `executor`, `reviewer`, `writer`, `tester`. Results are aggregated via `concat | last | llm`. The `agent-teams` plugin exposes orchestration to the engine as a tool.

### 7) Remote server runtime (`apps/remote-server`)
Hosts the engine behind HTTP/webhooks for Feishu and Discord (Telegram/Web adapters exist but are not mounted by default).

Key components:
- Entry + server: `apps/remote-server/src/index.ts`, `apps/remote-server/src/server.ts` (mounts `/health`, webhook routes, and `/internal/*`).
- Dispatcher: `apps/remote-server/src/core/dispatcher.ts` — webhook verification/ack, slash commands, per-`platformKey` concurrency, streaming via adapter `StreamHandle` callbacks.
- Agent runs: `apps/remote-server/src/core/agent-runner.ts` — builds run context, resolves model overrides, persists sessions, records daily memory logs.
- Clarification: `apps/remote-server/src/core/clarification-queue.ts` — routes clarification prompts/answers for webhook and gateway flows.
- Sessions: stored in `~/.pulse-coder/remote-sessions` (`index.json` + `sessions/*.json`).
- Memory: `pulse-coder-memory-plugin` writes daily logs to `~/.pulse-coder/remote-memory`.
- Worktrees: binding state in `~/.pulse-coder/worktree-state`; default code checkouts in `~/.pulse-coder/worktrees/<project>/wt-<id>`.
- Worktree command runner: `POST /internal/worktrees/:id/run` runs commands in a managed worktree with `backend: "host"` or `backend: "docker"` (default Docker image: `node:22-bookworm`, override with `PULSE_CODER_DOCKER_IMAGE`).
- Conversational coding: remote agent runs can call `worktree_prepare` and `worktree_run`, so requests like “help me implement X” can create/bind a worktree, edit there, validate with host package-level commands first, and escalate to Docker for risky or clean-environment validation.
- Model overrides: `.pulse-coder/config.json` or `$PULSE_CODER_MODEL_CONFIG` (`apps/remote-server/src/core/model-config.ts`).
- Adapters: Feishu (`adapters/feishu/*`), Discord webhooks (`adapters/discord/adapter.ts`) and DM gateway (`adapters/discord/gateway.ts`).
- Internal API: `POST /internal/agent/run`, `GET /internal/discord/gateway/status`, `POST /internal/discord/gateway/restart` — loopback-only, gated by `INTERNAL_API_SECRET`.
- Tools: registered in `apps/remote-server/src/core/engine-singleton.ts`, including `analyze_image`, `cron_job`, `jina_ai_read`, `read_linked_session`, `session_summary`, `twitter_list_tweets`, `lark_cli`, the `worktree_prepare`/`worktree_run` tools, and the `ptc_demo_*` tools. Some are `defer_loading: true` and only load after `tool-search` discovery.

---

## Built-in tools

Engine built-ins (registered in `packages/engine/src/tools/index.ts` via `BuiltinToolsMap`):
- `read`, `write`, `edit`, `grep`, `ls`, `bash`, `clarify`
- `tavily`, `tavily_extract`, `tavily_crawl`, `tavily_map` (Tavily search/extract/crawl/map)
- `generate_image` (GPT/OpenAI by default, Gemini optional)
- `deferred_demo` (deferred-loading demo tool)

Tools marked `defer_loading: true` (e.g. `generate_image`, the `tavily_*` variants, `deferred_demo`) only load after `tool-search` discovery.

Task tracking plugin adds:
- `task_create`, `task_get`, `task_list`, `task_update`

CLI additionally injects:
- `run_js` (sandboxed JavaScript execution)

---

## Quick start

### Prerequisites
- Node.js `>=18`
- `pnpm` (workspace manager — pinned to `pnpm@10.28.0` in `package.json`)

### 1) Install dependencies
```bash
pnpm install
```

### 2) Configure environment
Create `.env` at the repo root:

```env
# OpenAI-compatible provider (default)
OPENAI_API_KEY=your_key_here
OPENAI_API_URL=https://api.openai.com/v1
OPENAI_MODEL=novita/deepseek/deepseek_v3

# Optional Anthropic path
# USE_ANTHROPIC=true
# ANTHROPIC_API_KEY=...
# ANTHROPIC_API_URL=https://api.anthropic.com/v1
# ANTHROPIC_MODEL=claude-3-5-sonnet-latest

# Optional tools
# TAVILY_API_KEY=...
# GEMINI_API_KEY=...
```

### 3) Build
```bash
pnpm run build       # core workspace (packages/* + remote-server + teams-cli)
pnpm run build:all   # full workspace
```

### 4) Start the CLI
```bash
pnpm start
pnpm start:debug     # with debug logging
```

### 5) Remote server (optional)
```bash
pnpm --filter @pulse-coder/remote-server dev
```

### 6) Multi-agent teams preview (optional)
```bash
pnpm preview:teams        # build orchestrator/engine/agent-teams + run teams-cli preview
pnpm preview:teams:run    # preview "run" mode
pnpm preview:teams:plan   # preview "plan" mode
```

### 7) Canvas workspace (optional, Electron)
```bash
pnpm --filter canvas-workspace dev        # electron-vite dev (hot reload)
pnpm --filter canvas-workspace build      # production build
pnpm --filter canvas-workspace test       # vitest run (largest test suite in the repo)
```

---

## CLI commands

Inside the CLI (run `/help` for the full, current list):

- `/help`
- `/new [title]`
- `/resume <id>`
- `/sessions`
- `/search <query>`
- `/rename <id> <new-title>`
- `/delete <id>`
- `/clear`
- `/compact`
- `/skills [list|<name|index> <message>]`
- `/status`
- `/mode`
- `/plan`
- `/execute`
- `/solo`
- `/save`
- `/exit`

Interactive controls:
- `Esc` aborts the current response (or cancels a pending clarification)
- `Ctrl+C` exits after save

---

## Configuration conventions

### MCP
Create `.pulse-coder/mcp.json`:

```json
{
  "servers": {
    "remote_http": {
      "transport": "http",
      "url": "http://localhost:3060/mcp/server"
    },
    "legacy_sse": {
      "transport": "sse",
      "url": "https://example.com/sse"
    },
    "local_stdio": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "cwd": "."
    }
  }
}
```

Notes:
- `transport` supports `http`, `sse`, and `stdio`.
- If `transport` is omitted, it defaults to `http` for backward compatibility.
- `http`/`sse` use `url` (optional `headers`); `stdio` uses `command` (+ optional `args`, `env`, `cwd`).

### Skills
Create `.pulse-coder/skills/<skill-name>/SKILL.md`:

```md
---
name: my-skill
description: What this skill helps with
---

# Instructions
...
```

Optional remote skills config: `.pulse-coder/skills/remote.json`.

### Sub-agents
Create `.pulse-coder/agents/<agent-name>.md`:

```md
---
name: code-reviewer
description: Specialized code review helper
---

System prompt content here.
```

> Legacy `.coder/...` paths are still supported by most loaders.

---

## Environment variables

Common:
- `OPENAI_API_KEY`, `OPENAI_API_URL`, `OPENAI_MODEL`
- Anthropic path: `USE_ANTHROPIC`, `ANTHROPIC_API_KEY`, `ANTHROPIC_API_URL`, `ANTHROPIC_MODEL`
- Optional tools: `TAVILY_API_KEY`, `GEMINI_API_KEY`
- Default model: `novita/deepseek/deepseek_v3` (override via `OPENAI_MODEL` or `ANTHROPIC_MODEL`)

Context compaction tuning:
- `CONTEXT_WINDOW_TOKENS` (default `64000`)
- `COMPACT_TRIGGER` (default 75% of window), `COMPACT_TARGET` (default 50%), `KEEP_LAST_TURNS` (default `4`)
- `COMPACT_SUMMARY_MODEL`, `COMPACT_SUMMARY_MAX_TOKENS` (default `1200`), `MAX_COMPACTION_ATTEMPTS` (default `2`)

Clarification:
- `CLARIFICATION_ENABLED` (default `true`)
- `CLARIFICATION_TIMEOUT` (default `300000` ms)

Remote server:
- `INTERNAL_API_SECRET` — required for `/internal/*` routes (loopback only).
- `PULSE_CODER_MODEL_CONFIG` — alternative path for model overrides.

---

## Development commands

### Workspace-level
```bash
pnpm install
pnpm run build         # core workspace (packages/* + remote-server + teams-cli, SKIP_DTS=1)
pnpm run build:all     # full workspace
pnpm run dev           # core workspace
pnpm run dev:all       # full workspace
pnpm start             # pulse-coder-cli
pnpm start:debug       # CLI with debug logging
pnpm test              # alias for test:core
pnpm run test:core     # packages/* + remote-server + teams-cli
pnpm run test:packages # packages/* only
pnpm run test:apps     # apps/* workspace members (canvas-workspace, remote-server, teams-cli)
pnpm run test:all      # all packages and apps
```

### Package-level
```bash
pnpm --filter pulse-coder-engine test
pnpm --filter pulse-coder-engine typecheck
pnpm --filter pulse-coder-cli test
pnpm --filter pulse-sandbox test
pnpm --filter pulse-coder-memory-plugin test
pnpm --filter pulse-coder-plugin-kit test
pnpm --filter pulse-coder-orchestrator test
pnpm --filter pulse-coder-agent-teams test
pnpm --filter @pulse-coder/remote-server build
pnpm --filter @pulse-coder/remote-server dev
```

Packages use **vitest** (`vitest run`) for tests and `tsc --noEmit` for typechecking where those scripts exist. Notable gaps: `apps/remote-server` has no `test` or `typecheck` script (runtime app — manual testing via `curl` against `/internal/agent/run`); `packages/cli` has no `typecheck` script.

Notes:
- `pnpm-workspace.yaml` only includes the core set: all `packages/*`, `apps/remote-server`, `apps/teams-cli`, `apps/canvas-workspace`. Experimental apps (`apps/coder-demo`, `apps/devtools-web`, `apps/canvas-plugin-react-mf-note-demo`) stay in the repo but are excluded from default install/build.
- Use `build:all` / `dev:all` / `test:all` for full-workspace runs.

---

## Release

```bash
pnpm release
pnpm release:core
pnpm release -- --packages=engine,cli --bump=patch --tag=latest
```

The release script (`scripts/release-packages.mjs`) supports `--dry-run`, `--skip-version`, `--skip-build`, `--preid`, and `--packages=` filtering.

---

## License

[MIT](./LICENSE)
