# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in
`apps/canvas-workspace`. It complements the repo-root `CLAUDE.md`.

## Overview

**Pulse Canvas** (`canvas-workspace`) is an Electron desktop app that provides a
free-form, infinite canvas workspace for AI-assisted coding. Users arrange
**nodes** on a canvas and interact with an embedded AI agent powered by
`pulse-coder-engine`.

## Tech Stack

- **Electron** (v30) + **electron-vite** — desktop shell and build pipeline
- **React** (v18) + **wouter** — renderer UI and routing
- **Tiptap** (v3) — rich-text editor for file nodes
- **xterm.js** + **node-pty** — terminal emulation in terminal/agent nodes
- **pulse-coder-engine** + **pulse-coder-agent-teams** (`workspace:*`) — power the
  in-app AI agent and multi-agent flows
- **zod**, **markdown-it**, **mermaid**, **react-force-graph-2d** — schema,
  markdown, diagrams, and graph rendering

## Node Types

| Type | Description |
|------|-------------|
| `file` | Tiptap-based rich-text/markdown editor backed by a real file path |
| `terminal` | Full PTY terminal session |
| `agent` | Runs an external AI agent CLI (e.g. `claude`) in a PTY; accepts inline prompts or prompt files |
| `frame` | Visual grouping rectangle with a label/color |

## Views & Shortcuts

- **Canvas view** (`/`) — free-form canvas with sidebar, node editing, optional right-side chat panel.
- **Chat view** (`/chat`) — full-screen AI chat page backed by `pulse-coder-engine`.

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+A` | Toggle right-side chat panel (canvas view only) |
| `Cmd/Ctrl+Shift+L` | Toggle full-screen chat view |
| `Esc` | Return to canvas from chat view |

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
    index.ts        # Main entry
  preload/          # Context bridge (exposes window.canvasWorkspace API)
  renderer/src/
    components/     # Canvas, Sidebar, AgentNodeBody, FileNodeBody, chat/, …
    hooks/          # useWorkspaces, canvas interaction hooks
    editor/         # Tiptap editor setup
    config/ constants/ i18n/ utils/
    types.ts        # Shared types (CanvasNode, CanvasWorkspaceApi, …)
```

The renderer communicates with the main process **exclusively** through
`window.canvasWorkspace` (typed in `types.ts`), bridged via `src/preload/`.
Never reach into Electron/Node APIs directly from the renderer — add an IPC
channel in the relevant `src/main/<domain>/` module and expose it through preload.

See `docs/main-domain-modules.md` for the `src/main` module layout and migration
plan, and `docs/renderer-surfaces.md` for renderer surface breakdown.

## Dev & Build Commands

```bash
pnpm install                              # also runs electron-rebuild for node-pty
pnpm --filter canvas-workspace dev        # development (hot reload)
pnpm --filter canvas-workspace build      # production build
pnpm --filter canvas-workspace typecheck  # tsc --noEmit (renderer + main)
pnpm --filter canvas-workspace test       # vitest run

# Packaging (output → release/, appId com.pulse-coder.canvas-workspace)
pnpm --filter canvas-workspace package          # current platform
pnpm --filter canvas-workspace package:mac      # macOS dmg (arm64 + x64)
pnpm --filter canvas-workspace package:win      # Windows nsis x64
pnpm --filter canvas-workspace package:linux    # Linux AppImage + deb x64
```

`typecheck` runs two tsconfigs (`tsconfig.json` for renderer, `tsconfig.node.json`
for main). `dev:temp-home` runs against a throwaway `$HOME` sandbox.

## Canvas Agent & Model Config

The AI chat feature is powered by `CanvasAgentService` (`src/main/agent/`), which
wraps `pulse-coder-engine`. Each workspace keeps its own agent session, persisted
under the workspace data directory, and receives a workspace/node summary as
context on every turn.

Model settings are read from `~/.pulse-coder/canvas/model-config.json` by default
(override with `PULSE_CANVAS_MODEL_CONFIG`). The config supports OpenAI-compatible
and Anthropic-compatible providers and stores only **env var names** for API keys,
never secret values. The renderer manages the same config through
`window.canvasWorkspace.model` (`status`, `saveConfig`, `upsertOption`,
`setCurrent`, `removeOption`, `reset`); changes apply to new agent turns and HTML
generation without restarting the app.

## Data Persistence

Canvas state (node positions, types, data) is saved per workspace as JSON via
`src/main/canvas/`. File nodes are backed by real files on disk; the file watcher
pushes external changes into the renderer via IPC.

## Coding Guidance

- TypeScript strict mode; follow the repo-root conventions (2 spaces, semicolons,
  single quotes, ESM imports).
- Keep components focused and single-responsibility — aim for **≤ 300 lines per
  component**; split large components rather than growing them.
- Keep main/renderer separation clean: all cross-boundary calls go through
  `window.canvasWorkspace` + preload, with logic in `src/main/<domain>/`.
- Keep diffs minimal and preserve existing architecture patterns.
- Cross-package imports use workspace package names (`pulse-coder-engine`,
  `pulse-coder-agent-teams`).
