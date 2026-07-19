---
name: canvas
description: Operate Pulse Canvas workspaces — read user-curated context, write results, create nodes
version: 1.0.0
---

# Pulse Canvas

Interact with canvas workspaces via the `pulse-canvas` CLI. The canvas is a shared workspace between humans and agents.

The current workspace ID is available via `$PULSE_CANVAS_WORKSPACE_ID` environment variable (auto-set by canvas). All `node` and `context` commands use it automatically — no need to pass workspace ID explicitly.

Whenever `$PULSE_CANVAS_WORKSPACE_ID` is set, treat the canvas as required user-provided context. Before planning, coding, reviewing, or answering a workspace task, run `pulse-canvas context --format json` and use that result alongside repository files.

## Core Commands

### Read workspace context (start here)
```bash
pulse-canvas context --format json
```
Returns all nodes with structured info: file paths, frame groups, labels.

### List nodes
```bash
pulse-canvas node list --format json
```

### Read a node
```bash
pulse-canvas node read <nodeId> --format json
```

### Write to a node
```bash
pulse-canvas node write <nodeId> --content "..."
```

### Create a node
```bash
pulse-canvas node create --type file --title "Report" --data '{"content":"..."}'
```

Supported `--type` values: `file`, `terminal`, `frame`, `agent`, `mindmap`.

#### Mindmap

For mindmaps, pass the recursive topic tree under `data.root`. Topic ids are auto-generated — do NOT supply them yourself. If `--data` is omitted a placeholder root is inserted.

```bash
pulse-canvas node create --type mindmap --title "Roadmap" --data '{
  "root": {
    "text": "Roadmap",
    "children": [
      { "text": "Q1", "children": [
        { "text": "Ship MVP" },
        { "text": "Onboard 10 users" }
      ]},
      { "text": "Q2", "children": [
        { "text": "Public beta" }
      ]}
    ]
  }
}'
```

Topic shape: `{ text: string, children?: Topic[], color?: string, collapsed?: boolean }` (recursive). Use this whenever the user asks for a mindmap / brainstorm / outline that should be laid out radially rather than as a flat text node.

### Create an edge (connection between nodes)
```bash
pulse-canvas edge create --from <nodeId> --to <nodeId> --label "depends on" --kind dependency --format json
```

### List edges
```bash
pulse-canvas edge list --format json
```

### Delete an edge
```bash
pulse-canvas edge delete <edgeId> --format json
```

### List workspaces
```bash
pulse-canvas workspace list --format json
```

### Send input to a running agent node
```bash
pulse-canvas agent send <nodeId> --input "..."
```
Use this for follow-up prompts, approvals, corrections, or redirections to an already-running agent node. Enter is appended automatically.

Requirements:
- target node type must be `agent`
- agent status must be `running`
- the workspace must be open in Pulse Canvas (so the runtime is reachable)
- the node's PTY session must still be alive (closing the node tears it down)

Do NOT use `node write` for agent nodes — `node write` only modifies file/frame/group content. `agent send` delivers live input to the PTY session and is the only correct channel for talking to a running agent.

### Operate a live webpage

Choose the most direct runtime interface available:

1. Prefer task-specific native Canvas tools such as `canvas_read_webpage`, `page_click`,
   `page_fill`, or `page_eval` when the host provides them.
2. Otherwise, prefer the native `app_capabilities_list` and `app_capability_call` tools
   when they are available.
3. Use `pulse-canvas runtime ...` when the host does not provide native runtime tools.

These interfaces reach the same Capability Runtime. Do not shell out to
`pulse-canvas runtime` when an equivalent native tool is available.

When Pulse Canvas is running, discover the runtime capabilities before using them:

```bash
pulse-canvas runtime capabilities --format json
```

Prefer structured capabilities such as page read, click, and fill. If the user asks for behavior those capabilities cannot express, execute a JavaScript function body inside an open iframe node or right-dock link tab:

```bash
printf '%s' 'return { title: document.title, links: document.links.length }' |
  pulse-canvas runtime eval --node <nodeId> --stdin --format json
```

Requirements:
- Pulse Canvas must be running with **Agent runtime control** and **Webview page control (agent)** enabled.
- The target must be an open iframe node in URL mode or a right-dock link tab.
- Sensitive pages and unsafe URL schemes remain blocked by the app policy.
- Use `runtime eval` sparingly, return JSON-serialisable data, and read the page again after a mutation to verify the outcome.
- Runtime scripts execute in the target webpage, never in the Electron main process.

For non-preset operations on Pulse Canvas's own renderer UI, use the host renderer
capability only after structured Canvas tools prove insufficient:

```bash
printf '%s' 'return { title: document.title }' |
  pulse-canvas runtime host-eval --stdin --format json
```

`host-eval` requires **Agent runtime control**, is limited to the selected
workspace's host route, and must return JSON-serialisable data. It has no direct
Node `require`, but runs in the renderer main world and can use the exposed
`window.canvasWorkspace` bridge, including actions backed by main-process IPC.
Treat it as an unsafe full-app escape hatch: prefer stable capabilities, then
verify any mutation through a structured read.

## Usage Principles
- Before starting a task, run `pulse-canvas context --format json` to understand the user's canvas layout and intent
- Files on the canvas = files the user considers important — prioritize them
- Frame groups = file associations — understand files in the same group together
- Edges = relationships — understand how frames and nodes connect to each other
- After completing work, write results back to the canvas for the user to review
- Prefer native runtime tools over CLI fallback, and structured capabilities over
  `runtime eval`; use arbitrary scripts only for non-preset behavior
