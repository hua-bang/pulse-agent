---
name: canvas
description: Operate Pulse Canvas workspaces — read user-curated context, write results, create nodes
version: 1.0.0
---

# Pulse Canvas

Interact with canvas workspaces via the `pulse-canvas` CLI. The canvas is a shared workspace between humans and agents.

The current workspace ID is available via `$PULSE_CANVAS_WORKSPACE_ID` environment variable (auto-set by canvas). All `node` and `context` commands use it automatically — no need to pass workspace ID explicitly.

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

## Usage Principles
- Before starting a task, run `context` to understand the user's canvas layout and intent
- Files on the canvas = files the user considers important — prioritize them
- Frame groups = file associations — understand files in the same group together
- Edges = relationships — understand how frames and nodes connect to each other
- After completing work, write results back to the canvas for the user to review
