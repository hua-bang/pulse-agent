# @pulse-coder/canvas-cli

CLI for Pulse Canvas — lets external agents (Claude Code, Codex, etc.) read from and write to canvas workspaces.

Most commands operate directly on the JSON store at `~/.pulse-coder/canvas/` (default) without the Electron app being involved. When the app is running, its `fs.watch` picks up store changes automatically — no IPC required. The `agent`, `team`, and `runtime` command families are the exception: they require a running `apps/canvas-workspace` instance (documented under those commands below).

## Install

```bash
# From the monorepo
pnpm --filter @pulse-coder/canvas-cli build

# Or link globally (pnpm only — never npm/yarn)
cd packages/canvas-cli && pnpm link --global
```

Binary name: `pulse-canvas`.

## Global Options

| Flag | Description |
|------|-------------|
| `--format <json\|text>` | Output format: `json` or `text` (default: `text`) |
| `--store-dir <path>` | Canvas store directory (default: `~/.pulse-coder/canvas/`) |
| `-w, --workspace <id>` | Workspace ID (default: active workspace, or `$PULSE_CANVAS_WORKSPACE_ID`) |
| `--confine-to-workspace` | Refuse to read/write file-node paths outside the workspace directory (safer for untrusted canvases) |

**Workspace auto-discovery.** Commands resolve the target workspace in a fixed
order: `--workspace <id>` → `$PULSE_CANVAS_WORKSPACE_ID` (the Electron app sets
this for agent nodes automatically) → the app's active workspace
(`__workspaces__.json.activeId`). If none of these selects a workspace, the
command errors instead of guessing. Run `pulse-canvas workspace current` to see
which workspace commands will act on.

**Output & error contract (for machine callers).** Successful `--format json`
output is a JSON value on **stdout**. On failure the process exits non-zero and,
in `--format json`, prints a JSON object `{ "ok": false, "error": "…", "code":
"…" }` on **stderr** (in text mode it's a human `Error: …` line). Branch on the
stable `code` rather than the message. Common codes: `no_workspace_selected`,
`workspace_not_found`, `node_not_found`, `edge_not_found`, `invalid_argument`,
`unsupported`, `path_confined`, `confirmation_required`, and the runtime family
(`runtime_not_found`, `runtime_unreachable`, `runtime_auth`, …) for live commands.

## Commands

### Workspace

```bash
pulse-canvas workspace list                     # List all workspaces (active one flagged with *)
pulse-canvas workspace current                  # Show the workspace commands resolve to, and why
pulse-canvas workspace info <id>                # Node counts, types, last saved
pulse-canvas workspace create <name>            # Create a new workspace
pulse-canvas workspace delete <id> --confirm    # Delete (irreversible)
pulse-canvas workspace recover <id>             # Rebuild file nodes from notes/*.md files
pulse-canvas workspace recover <id> --dry-run   # Preview without writing
```

### Status & Describe

```bash
pulse-canvas status --format json    # Store dir, resolved/active workspace, runtime reachability
pulse-canvas describe --format json  # Machine-readable manifest: commands, node types, error codes
```

`status` is the recommended pre-flight for an external caller: it never exits
non-zero for "no workspace selected" (it reports that as data) and tells you
whether the Electron runtime is up, i.e. whether the live `agent`/`team`/`runtime`
commands are usable. `describe` emits a self-describing capability manifest
(with `describeVersion` and `contextVersion`) so an agent can plan against the
CLI without hard-coding its surface.

### Node

`node` commands use the resolved workspace (see **Workspace auto-discovery** above); pass `-w` only to override it.

```bash
pulse-canvas node list                          # List nodes with types and capabilities
pulse-canvas node list --type text              # …filtered to one type
pulse-canvas node search "checkout"             # Find nodes by title/content (no per-node read)
pulse-canvas node read <nodeId>                 # Read a node (single id → object)
pulse-canvas node read <id1> <id2> <id3>        # Batch read (multiple ids → array; misses become per-entry errors)
pulse-canvas node create --type file --title "Report" --data '{"content":"..."}'
pulse-canvas node write <nodeId> --content "..."        # interprets \n, \t escapes (file/text/frame/group)
pulse-canvas node write <nodeId> --content "..." --raw  # verbatim, no unescaping
pulse-canvas node write <nodeId> --file ./result.md     # read content from file
echo "hello" | pulse-canvas node write <nodeId>         # read from stdin
pulse-canvas node write <frameId> --content '{"label":"New title","color":"#9575d4"}'  # frame/group: JSON patch
pulse-canvas node update <nodeId> --x 400 --y 200 --title "Moved"  # reposition/resize/rename (layout only)
pulse-canvas node delete <nodeId>
```

Node types and capabilities (the capability map reported by `node list`):

| Type | Capabilities | Notes |
|------|-------------|-------|
| `file` | read, write | Backed by a real file; content is markdown |
| `terminal` | read, exec | PTY session (read-only from CLI — no active PTY) |
| `frame` | read, write | Visual grouping rectangle; `node write` expects JSON `{label?,color?}` |
| `group` | read, write | Container of child nodes; `node write` expects JSON `{label?,color?,childIds?}` |
| `agent` | read, exec | Agent PTY node (read-only from CLI; use `agent send` for live input) |
| `mindmap` | read, write | Topic tree; initialize via `--data '{"root":{"text":"...","children":[...]}}'` |
| `text` | read, write | Markdown text card (content, font, color); `node write` replaces its `content` |
| `iframe` | read | Embedded page (`mode`, `url`, `html`, `prompt`, `artifactId`, `pageTitle`) |
| `image` | read | Local image (`filePath`) |
| `shape` | read | Shape with text/style |
| `dynamic-app` | read | Dynamic app embed (`url`, `dynamicAppId`) |
| `plugin` | read | Plugin node (`pluginId`, `nodeType`, `version`, `payload`) |
| `reference` | read | Snapshot reference to another node |

`node create` accepts only the creatable types: `file`, `terminal`, `frame`, `group`, `agent`, and `mindmap`. The remaining types above are produced by the canvas app and are **read-only** from the CLI — `node read <id> --format json` returns their full persisted metadata. Unrecognized (future) node types still load and read as opaque nodes rather than breaking the CLI. `node write` supports `file`, `text`, `frame`, and `group`; `terminal`/`agent` require a live PTY. Pass `--confine-to-workspace` so a `file` node whose `filePath` points outside the workspace directory is refused (read falls back to in-memory content, write errors with code `path_confined`) — recommended when the canvas may be untrusted.

> **iframe/dynamic-app content.** `node read` returns only what the store persists — for a URL-mode iframe that is the metadata (url, pageTitle, …), not the live web page body, which lives in the running Electron webview rather than the canvas store. With the Electron app running, use `runtime call browser.page.read --input '{"nodeId":"<nodeId>"}'` for the rendered page; plain `node read` never connects to Electron or fetches the network.

### Edge

All `edge` commands require a workspace (via `-w` or `$PULSE_CANVAS_WORKSPACE_ID`).

```bash
pulse-canvas edge list                                   # List all edges
pulse-canvas edge create --from <nodeId> --to <nodeId> \
  [--label <text>] [--kind <kind>] \
  [--from-anchor top|right|bottom|left|auto] \
  [--to-anchor top|right|bottom|left|auto] \
  [--arrow-head none|triangle|arrow|dot|bar] \
  [--arrow-tail none|triangle|arrow|dot|bar] \
  [--color <hex>] [--width <n>] [--style solid|dashed|dotted] [--bend <n>]
pulse-canvas edge delete <edgeId>
```

`--width` and `--bend` are pixel values (numbers); `--bend 0` draws a straight line. `--kind` is a free-form semantic tag (e.g. `dependency`, `flow`).

### Context

```bash
pulse-canvas context                       # Structured summary of all nodes in the workspace
pulse-canvas context --format json         # Machine-readable for agent consumption
pulse-canvas context --types file,text     # Only include the listed node types (edges follow)
```

The JSON output carries a `contextVersion` field (the output-contract version) so callers can detect an incompatible CLI.

Returns workspace metadata plus a per-node summary: file paths, frame labels, terminal cwds, agent statuses, text excerpts, and iframe/embed metadata. This is the recommended entry point for agents — run it first to understand the canvas layout. To stay prompt-friendly, `context` deliberately excerpts long `text` bodies and omits heavy fields (an iframe's inlined `html`/`prompt`, a plugin's `payload`); fetch the full content of a specific node with `node read <id> --format json`.

> **Runtime requirement — `agent`, `team`, and `runtime`.** These families do not read the JSON store. They require a running `apps/canvas-workspace` instance and authenticate to its loopback runtime-control server using the bearer secret in `~/.pulse-coder/canvas-runtime/canvas-workspace.json`. Without it they fail with `No active canvas-workspace runtime found.` — open the workspace in Pulse Canvas first. All other command families (`workspace`, `node`, `edge`, `context`, `restore`, `install-skills`) operate directly on the store and need no runtime.

### Runtime

Discover and call live application capabilities:

```bash
pulse-canvas runtime capabilities --format json
pulse-canvas runtime call browser.tabs.list --input '{}' --format json
```

With **Agent runtime control** and **Webview page control (agent)** enabled,
Claude Code and Codex can execute JavaScript inside an open iframe node or
right-dock link tab. Prefer file or stdin input so scripts are not exposed in
process arguments:

```bash
pulse-canvas runtime eval --node <nodeId> --file ./script.js --format json
printf '%s' 'return document.title' |
  pulse-canvas runtime eval --node <nodeId> --stdin --format json
```

The app still applies its sensitive-domain and URL-scheme policy. The script
runs in the selected webpage, never in the Electron main process.

For a non-preset operation on Pulse Canvas's own renderer UI, use the separate
host escape hatch after structured Canvas capabilities prove insufficient:

```bash
printf '%s' 'return { title: document.title }' |
  pulse-canvas runtime host-eval --stdin --format json
```

`host-eval` requires **Agent runtime control**, checks the selected workspace
route before executing, and must return JSON-serialisable data. It has no direct
Node `require`, but runs in the host page's main world and can call the
renderer-exposed `window.canvasWorkspace` bridge; treat it as full experimental
app control for same-user local code.

### Agent

Send follow-up input to a running agent node (an Enter is appended automatically). Requires the live runtime (see above).

```bash
pulse-canvas agent send <nodeId> --input <text>
```

### Team

Agent Teams surface — drive team planning, task lifecycle, and inter-agent messaging through the live runtime (see above). Team ID defaults to `$PULSE_CANVAS_TEAM_ID`; the acting agent defaults to `$PULSE_CANVAS_TEAM_AGENT_ID`.

```bash
pulse-canvas team propose-plan --team <id> --plan-file ./plan.json [--source-agent <id>]
pulse-canvas team propose-plan --team <id> --plan-json '<json>'

pulse-canvas team create-task --team <id> --title "Title" --description "..." \
  [--owner <agent>] [--dep <task>...] [--scope <path>...] [--verify <cmd>] [--dispatch]   # Team Lead only

pulse-canvas team dispatch --team <id>

pulse-canvas team complete-task --team <id> [--task <id>] [--summary "..."]   # summary also accepted as trailing args
pulse-canvas team block-task --team <id> [--task <id>] [--reason "..."]
pulse-canvas team cancel-task --team <id> --task <id> [--reason "..."]        # Team Lead / human only

pulse-canvas team status [--team <id>]   # omit --team to list all teams in the workspace

pulse-canvas team request-human-input --team <id> [--task <id>] [--reason "..."] --prompt "..."
pulse-canvas team publish-artifact --team <id> --title "Title" [--kind other] [--uri <uri>] [--summary "..."]
pulse-canvas team complete-team --team <id> --summary "..."                    # Team Lead only

pulse-canvas team send --team <id> --to <agent> [--task <id>] --message "..."
```

`--dep` and `--scope` are repeatable. `create-task`, `complete-task`, `block-task`, `cancel-task`, `request-human-input`, `publish-artifact`, and `complete-team` accept an optional `--source-agent` (default `$PULSE_CANVAS_TEAM_AGENT_ID`).

### Restore

Recover a workspace from a v1-shape `canvas.json` snapshot — for the case where a v1-unaware writer clobbered a v2 workspace's `canvas.json` and the app's pollution guard refuses to migrate it. `restore` only accepts v1-shape full-data backups (the `canvas.json.v1.*.bak` files); it does not migrate `nodes/<id>.json` contents (that is the v2 app's job).

```bash
pulse-canvas restore list [workspaceId]                            # List available v1 snapshots
pulse-canvas restore apply [workspaceId] --from <path>             # Replace canvas.json with the snapshot
pulse-canvas restore apply [workspaceId] --from <path> --dry-run   # Print the plan without writing
pulse-canvas restore apply [workspaceId] --from <path> --yes       # Skip the confirmation prompt
```

`apply` always writes a pre-restore backup of the current `canvas.json` and archives the live `nodes/` directory out of the way so the app's lazy migration runs cleanly on next open.

### Install Skills

```bash
pulse-canvas install-skills               # Install to all global skill dirs
pulse-canvas install-skills --dir <path>  # Install to a specific directory
```

Copies bundled `SKILL.md` files into global skill directories so that agents (Claude Code, Codex, etc.) discover canvas capabilities automatically. Installed skill names:

- `pulse-canvas` (sourced from `skills/canvas/`, frontmatter `name:` rewritten to `pulse-canvas`)
- `canvas-deep-research`
- `canvas-frame-research`
- `canvas-bootstrap`

Target directories (when run without `--dir`):

- `~/.pulse-coder/skills/`
- `~/.claude/skills/`
- `~/.codex/skills/`

## Programmatic API

The `./core` subpath export provides store and node operations without the CLI layer. This package is CommonJS (`"type": "commonjs"`, built as `cjs` only); the `./core` export exposes a `require` condition:

```js
const {
  loadCanvas,
  saveCanvas,
  listWorkspaceIds,
  createWorkspace,
} = require('@pulse-coder/canvas-cli/core');
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
