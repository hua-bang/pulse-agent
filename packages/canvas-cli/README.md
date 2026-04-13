# @pulse-coder/canvas-cli

CLI for Pulse Canvas — lets external agents (Claude Code, Codex, etc.) read from and write to canvas workspaces without the Electron app being involved.

The CLI operates directly on the JSON store at `~/.pulse-coder/canvas/` (default). When the Electron app is running, its `fs.watch` picks up changes automatically — no IPC required.

## Install

```bash
# From the monorepo
pnpm --filter @pulse-coder/canvas-cli build

# Or link globally
cd packages/canvas-cli && npm link
```

Binary name: `pulse-canvas`.

## Global Options

| Flag | Description |
|------|-------------|
| `--format <json\|text>` | Output format (default: `text`) |
| `--store-dir <path>` | Canvas store directory (default: `~/.pulse-coder/canvas/`) |
| `-w, --workspace <id>` | Workspace ID (default: `$PULSE_CANVAS_WORKSPACE_ID`) |

The Electron app sets `PULSE_CANVAS_WORKSPACE_ID` for agent nodes automatically, so most commands need no explicit workspace flag.

## Commands

### Workspace

```bash
pulse-canvas workspace list                     # List all workspaces
pulse-canvas workspace info <id>                # Node counts, types, last saved
pulse-canvas workspace create <name>            # Create a new workspace
pulse-canvas workspace delete <id> --confirm    # Delete (irreversible)
pulse-canvas workspace recover <id>             # Rebuild file nodes from notes/*.md files
pulse-canvas workspace recover <id> --dry-run   # Preview without writing
```

### Node

All `node` commands require a workspace (via `-w` or `$PULSE_CANVAS_WORKSPACE_ID`).

```bash
pulse-canvas node list                          # List nodes with types and capabilities
pulse-canvas node read <nodeId>                 # Read node content
pulse-canvas node create --type file --title "Report" --data '{"content":"..."}'
pulse-canvas node write <nodeId> --content "..."        # interprets \n, \t escapes
pulse-canvas node write <nodeId> --content "..." --raw  # verbatim, no unescaping
pulse-canvas node write <nodeId> --file ./result.md     # read content from file
echo "hello" | pulse-canvas node write <nodeId>         # read from stdin
pulse-canvas node delete <nodeId>
```

Node types and capabilities:

| Type | Capabilities | Notes |
|------|-------------|-------|
| `file` | read, write | Backed by a real file; content is markdown |
| `terminal` | read, exec | PTY session (read-only from CLI — no active PTY) |
| `frame` | read | Visual grouping rectangle with label/color |
| `agent` | read, exec | Agent PTY node (read-only from CLI) |

### Context

```bash
pulse-canvas context                # Structured summary of all nodes in the workspace
pulse-canvas context --format json  # Machine-readable for agent consumption
```

Returns workspace metadata plus a per-node summary: file paths, frame labels, terminal cwds, agent statuses. This is the recommended entry point for agents — run it first to understand the canvas layout.

### Install Skills

```bash
pulse-canvas install-skills               # Install to all global skill dirs
pulse-canvas install-skills --dir <path>  # Install to a specific directory
```

Copies bundled `SKILL.md` files (`canvas`, `canvas-bootstrap`) into global skill directories so that agents (Claude Code, Codex, etc.) discover canvas capabilities automatically. Target directories:

- `~/.pulse-coder/skills/`
- `~/.claude/skills/`
- `~/.codex/skills/`

## Programmatic API

The `core` subpath export provides store and node operations without the CLI layer:

```typescript
import {
  loadCanvas,
  saveCanvas,
  listWorkspaceIds,
  createWorkspace,
} from '@pulse-coder/canvas-cli/core';
```

## Agent Integration Flow

1. Agent spawns inside a canvas agent node → `$PULSE_CANVAS_WORKSPACE_ID` is set
2. Agent runs `pulse-canvas context --format json` to discover canvas layout
3. Agent reads relevant file nodes with `pulse-canvas node read <id>`
4. Agent does its work (code changes, research, etc.)
5. Agent writes results back with `pulse-canvas node write <id> --content "..."`
6. Electron main detects the canvas.json change via `fs.watch` and refreshes the UI

## Build & Test

```bash
pnpm --filter @pulse-coder/canvas-cli build      # tsup + copy skills/
pnpm --filter @pulse-coder/canvas-cli test
pnpm --filter @pulse-coder/canvas-cli typecheck
```
