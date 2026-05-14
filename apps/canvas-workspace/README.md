# Pulse Canvas

An Electron desktop app that provides a free-form canvas workspace for AI-assisted coding. Users arrange **nodes** on an infinite canvas and interact with an embedded AI agent.

## Tech Stack

- **Electron** (v30) + **electron-vite** — desktop shell and build pipeline
- **React** (v18) + **wouter** — renderer UI and routing
- **Tiptap** — rich-text editor for file nodes
- **xterm.js** + **node-pty** — terminal emulation in terminal/agent nodes
- **pulse-coder-engine** — powers the in-app AI agent (chat and canvas agent nodes)

## Node Types

| Type | Description |
|------|-------------|
| `file` | Tiptap-based rich-text/markdown editor backed by a real file path |
| `terminal` | Full PTY terminal session |
| `agent` | Runs an external AI agent CLI (e.g. `claude`) in a PTY; accepts inline prompts or prompt files |
| `frame` | Visual grouping rectangle with a label/color |

## Views

- **Canvas view** (`/`) — free-form canvas with sidebar, node editing, and an optional right-side chat panel.
- **Chat view** (`/chat`) — full-screen AI chat page backed by `pulse-coder-engine`.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+A` | Toggle right-side chat panel (canvas view only) |
| `Cmd/Ctrl+Shift+L` | Toggle full-screen chat view |
| `Esc` | Return to canvas from chat view |

## Project Structure

```
src/
  main/             # Electron main process
    canvas-agent/   # CanvasAgent + CanvasAgentService (engine-backed AI chat)
    canvas-store.ts # Canvas state persistence (JSON per workspace)
    file-manager.ts # File read/write/dialog IPC handlers
    file-watcher.ts # Filesystem watcher → external update events
    mcp-server.ts   # Local MCP server exposed to agent nodes
    pty-manager.ts  # node-pty session management
    skill-installer.ts
  preload/          # Context bridge (exposes window.canvasWorkspace API)
  renderer/src/
    components/     # Canvas, Sidebar, AgentNodeBody, FileNodeBody, chat/, …
    hooks/          # useWorkspaces, canvas interaction hooks
    types.ts        # Shared types (CanvasNode, CanvasWorkspaceApi, …)
```

The renderer communicates with the main process exclusively through `window.canvasWorkspace` (defined in `types.ts`), which is bridged via `src/preload/`.

## Dev & Build Commands

```bash
# Install (also runs electron-rebuild for node-pty)
pnpm install

# Development (hot reload)
pnpm --filter canvas-workspace dev

# Production build
pnpm --filter canvas-workspace build

# Package for distribution
pnpm --filter canvas-workspace package          # current platform
pnpm --filter canvas-workspace package:mac      # macOS dmg (arm64 + x64)
pnpm --filter canvas-workspace package:win      # Windows nsis x64
pnpm --filter canvas-workspace package:linux    # Linux AppImage + deb x64

# Typecheck
pnpm --filter canvas-workspace typecheck
```

Packaged output goes to `release/`. App ID: `com.pulse-coder.canvas-workspace`.

## Canvas Agent

The AI chat feature is powered by `CanvasAgentService` (`src/main/canvas-agent/`), which wraps `pulse-coder-engine`. Each workspace maintains its own agent session, persisted under the workspace data directory. The agent receives a workspace/node summary as context on every turn.


### Custom model configuration

Pulse Canvas reads model settings from `~/.pulse-coder/canvas/model-config.json` by default. Set `PULSE_CANVAS_MODEL_CONFIG` to use another path. The config supports OpenAI-compatible and Anthropic-compatible providers and stores only environment variable names for API keys, not secret values.

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

The renderer can also manage the same config through `window.canvasWorkspace.model` (`status`, `saveConfig`, `upsertOption`, `setCurrent`, `removeOption`, `reset`). Changes apply to new Canvas Agent turns and HTML generation requests without restarting the app.

## Data Persistence

Canvas state (node positions, types, data) is saved per workspace as JSON via `canvas-store.ts`. File nodes are backed by real files on disk; the file watcher pushes external changes into the renderer via IPC.
