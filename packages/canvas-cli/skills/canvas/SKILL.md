---
name: canvas
description: Operate Pulse Canvas workspaces — read user-curated context, write results, create nodes
version: 1.0.0
---

# Pulse Canvas

Interact with canvas workspaces via the `pulse-canvas` CLI. The canvas is a shared workspace between humans and agents.

## Core Commands

### Read workspace context (start here)
```bash
pulse-canvas context <workspaceId> --format json
```
Returns all nodes with structured info: file paths, frame groups, labels.

### List workspaces
```bash
pulse-canvas workspace list --format json
```

### List nodes
```bash
pulse-canvas node list <workspaceId> --format json
```

### Read a node
```bash
pulse-canvas node read <workspaceId> <nodeId> --format json
```

### Write to a node
```bash
pulse-canvas node write <workspaceId> <nodeId> --content "..."
```

### Create a node
```bash
pulse-canvas node create <workspaceId> --type file --title "Report" --data '{"content":"..."}'
```

## Usage Principles
- Before starting a task, run `context` to understand the user's canvas layout and intent
- Files on the canvas = files the user considers important — prioritize them
- Frame groups = file associations — understand files in the same group together
- After completing work, write results back to the canvas for the user to review
