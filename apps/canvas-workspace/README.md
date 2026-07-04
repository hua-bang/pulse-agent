# Pulse Canvas

An Electron desktop app that provides a free-form canvas workspace for AI-assisted coding. Users arrange **nodes** on an infinite canvas and interact with an embedded AI agent.

> Deeper detail lives downstream: [`AGENTS.md`](./AGENTS.md) (local router + constraints), [`docs/`](./docs/) (architecture, conventions, renderer surfaces), and [`harness/README.md`](./harness/README.md) (local harness routing). Repository-level routing is in [`../../harness/README.md`](../../harness/README.md).

## Tech Stack

- **Electron** (v30) + **electron-vite** — desktop shell and build pipeline
- **React** (v18) + **wouter** — renderer UI and routing
- **Tiptap** — rich-text editor for file nodes
- **xterm.js** + **node-pty** — terminal emulation in terminal/agent nodes
- **pulse-coder-engine** + **pulse-coder-agent-teams** (`workspace:*`) — power the in-app AI agent (chat and canvas agent nodes) and multi-agent flows

## Node Types

| Type | Description |
|------|-------------|
| `file` | Tiptap-based rich-text/markdown editor backed by a real file path |
| `terminal` | Full PTY terminal session |
| `agent` | Runs an external AI agent CLI (e.g. `claude`) in a PTY; accepts inline prompts or prompt files |
| `frame` | Visual grouping rectangle with a label/color |

The table above lists only the most common types. The canonical set is defined in [`src/shared/canvas.ts`](./src/shared/canvas.ts) and also includes `group`, `text`, `iframe`, `image`, `shape`, `mindmap`, `reference`, `dynamic-app`, and the extensible `plugin` type. `plugin` and `dynamic-app` each ship dedicated renderer components ([`PluginNodeBody`](./src/renderer/src/components/PluginNodeBody/), [`DynamicAppNodeBody`](./src/renderer/src/components/DynamicAppNodeBody/)).

## Views

- **Canvas view** (`/`) — free-form canvas with sidebar, node editing, and an optional right-side chat panel.
- **Chat view** (`/chat`) — full-screen AI chat page backed by `pulse-coder-engine`.
- **Nodes view** (`/nodes`) — workspace-wide node library with per-node detail pages. Gated by the `workspace-nodes-page` experimental flag.
- **Graph view** (`/graph`) — force-directed graph of all workspace nodes. Gated by the `workspace-graph-page` experimental flag.

Built-in plugins may also contribute their own routes via the plugin route registry (`src/plugins/renderer`).

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+L` | Toggle full-screen chat view |
| `Esc` | Return to canvas from chat view |
| `?` | Open the keyboard shortcuts overlay |

The right-side chat panel is toggled from the canvas toolbar or the command palette (`toggle-chat`); it has no dedicated global keybinding. (A `Cmd/Ctrl+Shift+A` label appears in the palette and toolbar as display text only — it is not wired to a keydown handler.)

## Project Structure

```
src/
  main/             # Electron main process (domain-based modules)
    app/            # Electron bootstrap, window, protocol, logging, link policy
    agent/          # CanvasAgent + CanvasAgentService (engine-backed AI chat)
    agent-teams/    # Multi-agent teams integration (pulse-coder-agent-teams)
    artifacts/      # Artifact persistence and artifact IPC
    canvas/         # Canvas persistence, storage migration, nodes, tags, broadcast
    files/          # File read/write/dialog IPC and filesystem watcher
    generation/     # HTML generation and streaming IPC
    runtime/        # Runtime control server and MCP helpers
    settings/       # App/model settings persistence and IPC
    terminal/       # node-pty session management
    webview/        # Webview registry, CDP helpers, page reader
  preload/          # Context bridge (exposes window.canvasWorkspace API)
  renderer/src/
    components/     # Canvas, Sidebar, AgentNodeBody, FileNodeBody, chat/, …
    hooks/          # useWorkspaces, canvas interaction hooks
    editor/         # Tiptap editor setup
    config/ constants/ i18n/ utils/
    types/          # Per-domain renderer type modules
    types.ts        # Barrel re-export + global window.canvasWorkspace type
```

The renderer communicates with the main process exclusively through `window.canvasWorkspace` (typed in `types.ts`), which is bridged via `src/preload/`.

See [`docs/main-domain-modules.md`](./docs/main-domain-modules.md) for the domain-based `src/main` module layout and [`docs/renderer-surfaces.md`](./docs/renderer-surfaces.md) for the renderer surface breakdown. Coding conventions live in [`docs/conventions/`](./docs/conventions/README.md).

## Dev & Build Commands

```bash
# Install (also runs electron-rebuild for node-pty)
pnpm install

# Development (hot reload)
pnpm --filter canvas-workspace dev

# Development against a throwaway $HOME sandbox (safe for smoke checks)
pnpm --filter canvas-workspace dev:temp-home

# Production build
pnpm --filter canvas-workspace build

# Typecheck (renderer + main tsconfigs)
pnpm --filter canvas-workspace typecheck

# Tests (vitest run)
pnpm --filter canvas-workspace test

# Package for distribution
pnpm --filter canvas-workspace package          # current platform
pnpm --filter canvas-workspace package:mac      # macOS dmg (arm64 + x64)
pnpm --filter canvas-workspace package:win      # Windows nsis x64
pnpm --filter canvas-workspace package:linux    # Linux AppImage + deb x64
```

Packaged output goes to `release/`. App ID: `com.pulse-coder.canvas-workspace`.

## Harness

The app ships an app-specific Electron harness for interaction-heavy or visual work: it launches the real Electron app under a controlled `HOME`, then lets follow-up commands observe or operate the same window.

```bash
pnpm --filter canvas-workspace harness start --profile demo --build   # launch (temp/demo/clone profiles)
pnpm --filter canvas-workspace harness status
pnpm --filter canvas-workspace harness screenshot
pnpm --filter canvas-workspace harness snapshot-ui
pnpm --filter canvas-workspace harness logs --lines 120
pnpm --filter canvas-workspace harness close --cleanup
```

Use `temp`, `demo`, or `clone` profiles by default; `real --allow-real-writes` can mutate real Pulse Canvas data. See [`harness/tools/runtime/README.md`](./harness/tools/runtime/README.md) and [`AGENTS.md`](./AGENTS.md) for the full command set and profile semantics.

## Canvas Agent

The AI chat feature is powered by `CanvasAgentService` (`src/main/agent/`), which wraps `pulse-coder-engine`. Each workspace maintains its own agent session, persisted under the workspace data directory. The agent receives a workspace/node summary as context on every turn.

### Custom model configuration

Pulse Canvas reads model settings from `~/.pulse-coder/canvas/model-config.json` by default. Set `PULSE_CANVAS_MODEL_CONFIG` to use another path. The config supports OpenAI-compatible and Anthropic-compatible providers. API keys are stored only as env-var names (`api_key_env`) or as a locally obfuscated `encrypted_api_key` (Base64, not OS-backed secrets) — never echoed back as plain values in status output.

The recommended shape uses a `providers` array, each with its own `models` and an optional `encrypted_api_key`:

```json
{
  "current_provider": "deepseek",
  "current_model": "deepseek-chat",
  "providers": [
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "provider_type": "openai",
      "base_url": "https://api.deepseek.com/v1",
      "api_key_env": "DEEPSEEK_API_KEY",
      "models": [{ "id": "deepseek-chat" }, { "id": "deepseek-reasoner" }]
    }
  ]
}
```

A legacy flat `options` array (with `current_model`) is still parsed for backward compatibility:

```json
{
  "current_model": "deepseek",
  "options": [
    {
      "name": "deepseek",
      "provider_type": "openai",
      "model": "deepseek-chat",
      "base_url": "https://api.deepseek.com/v1",
      "api_key_env": "DEEPSEEK_API_KEY"
    }
  ]
}
```

The renderer manages the same config through `window.canvasWorkspace.model`: `status`, `saveConfig`, `upsertProvider`, `removeProvider`, `fetchModels`, `upsertOption`, `setCurrent`, `removeOption`, `reset`. Changes apply to new Canvas Agent turns and HTML generation requests without restarting the app.

## Data Persistence

Canvas state (node positions, types, data) is saved per workspace as JSON via `src/main/canvas/`. File nodes are backed by real files on disk; the file watcher pushes external changes into the renderer via IPC.
