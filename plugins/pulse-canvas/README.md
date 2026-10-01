# Pulse Canvas agent plugin

Open and edit your local Pulse Canvas workspaces from an agent such as Codex.
The plugin follows the [Agent Plugins 1.0.0](https://agent-plugins.org/specification)
layout:

| Path | Role |
|---|---|
| `plugin.json` | Manifest; `extensions["com.openai"]` adds the Codex display name and icon |
| `mcp.json` | One stdio MCP server, started through `bin/pulse-canvas-mcp` |
| `bin/pulse-canvas-mcp` | Launcher that execs the CLI installed by the Pulse Canvas app |
| `skills/` | Pulse Canvas skills, generated from `packages/canvas-cli/skills` |
| `assets/icon.png` | Composer icon |

## What you get

- **Node view (MCP App).** `canvas_open` shows one canvas node inline in the
  conversation, rendered with Pulse Canvas's own node components so it looks
  the way it does in the app. Mindmaps and text nodes are editable there and
  save straight to the canvas; notes render read-only; terminal, agent, web,
  and plugin nodes point back to the app. Edits made in the app, the CLI, or
  by the agent show up in an open view within a few seconds.
- **Context.** After the user edits a node, the view tells the agent the
  node's current content, so "expand this branch" just works.
- **Tools.** `canvas_list_workspaces`, `canvas_context`, `canvas_search`,
  `canvas_read_nodes`, and `canvas_apply` (atomic batch of node/edge changes).
- **Skills.** The same Pulse Canvas skills the app installs for CLI workflows.

## Requirements

Install and open the Pulse Canvas desktop app once. It installs the CLI under
`~/.pulse-coder/tooling/pulse-canvas/` and the launcher
`~/.pulse-coder/bin/pulse-canvas`, which runs on the app's bundled runtime
(no system Node needed). The plugin contains no server code of its own, so the
MCP server always matches the installed app. To use another build, set
`PULSE_CANVAS_BIN` to a `pulse-canvas` executable.

The launcher is a POSIX shell script: macOS and Linux are supported; Windows is
not yet.

## Install

This repository publishes a marketplace at `.agents/plugins/marketplace.json`.
Add the repository as a plugin marketplace in your agent, then install
`pulse-canvas`. Hosts that render MCP Apps (Codex desktop among them) show the
node view; hosts without MCP Apps support still get the tools and skills.

## Compatibility

`bin/pulse-canvas-mcp` passes `--plugin-api <n>` to `pulse-canvas mcp`. If the
installed app is older than the plugin expects, the server starts in an
upgrade-only mode whose single `canvas_status` tool explains that the app
needs an update, instead of failing to connect.

## Safety

- The server speaks MCP over stdio only; it opens no ports.
- Reads and writes are confined to each workspace directory: a file node that
  points elsewhere is shown from its cached text and cannot be edited.
- The view has no network access (empty CSP domain lists), and it can only
  change the fields the server whitelists per node type (text styling, mindmap
  topics).

## Maintenance

- Server: `packages/canvas-cli/src/mcp/`. Node view:
  `apps/canvas-workspace/src/renderer/src/modules/mcp-node-view/`, built by
  `pnpm --filter canvas-workspace build:node-view` and packaged next to the
  bundled CLI.
- After editing `packages/canvas-cli/skills/`, run
  `pnpm --filter @pulse-coder/canvas-cli build && pnpm --filter @pulse-coder/canvas-cli sync:plugin-skills`.
  `src/mcp/__tests__/plugin-package.test.ts` fails while the copy is stale.
- Bump `PLUGIN_API` in the launcher together with `MCP_PLUGIN_API_VERSION`
  when a plugin release depends on new server behavior.
