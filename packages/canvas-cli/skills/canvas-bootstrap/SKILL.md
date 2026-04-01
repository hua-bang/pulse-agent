---
name: canvas-bootstrap
description: Research a topic and build a structured canvas workspace with frames, files, and terminals
version: 1.1.0
---

# Canvas Bootstrap

Given a topic or task, research relevant information and create a structured canvas workspace with organized nodes.

## Workflow

### 1. Analyze the topic (think first, act later)

Before creating anything, spend time understanding what the user needs:

- **What is the topic about?** — Identify the domain, scope, and key dimensions
- **Who is the audience?** — Is this for the user's own reference, a team, or a presentation?
- **What are the key sub-topics?** — Break the topic into 3-5 logical groups
- **What information exists?** — Search the web, read local files, check existing codebases
- **What actions are needed?** — Are there tasks, experiments, or builds to track?

Output your analysis as a brief internal plan before proceeding. Example:

> Topic: "Build a REST API for user management"
> Sub-topics: Architecture, Auth, Database, API Endpoints, Testing
> Groups: Design (arch + API spec), Implementation (code + DB), Operations (deploy + test)
> Content needed: tech stack decision, endpoint spec, DB schema, task checklist
> Terminal contexts: dev server, test runner

### 2. Research and gather information

Use available tools to collect relevant content:

- **Web search** for best practices, comparisons, reference architectures
- **Read local files** if the topic relates to an existing project
- **Summarize findings** — don't dump raw search results into nodes; synthesize

The goal is to produce content that helps the user make decisions and take action, not just raw information.

### 3. Design the canvas structure

Plan the spatial layout on paper before creating nodes:

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Frame: Overview │  │ Frame: Research  │  │  Frame: Tasks   │
│                  │  │                  │  │                 │
│  - Summary       │  │  - Findings      │  │  - Todo list    │
│  - Goals         │  │  - Comparisons   │  │  - Timeline     │
│  - Constraints   │  │  - References    │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

Decide:
- How many frames (2-4 is ideal, more gets cluttered)
- What file nodes go in each logical group
- Whether terminal nodes are needed (only if there's something to execute)
- What content each file node should contain (outline first, then write)

### 4. Create workspace (if needed)

If no workspace is active (`$PULSE_CANVAS_WORKSPACE_ID` is not set), create one:

```bash
pulse-canvas workspace create "<topic>" --format json
```

Then use the returned workspace ID with `--workspace <id>` for subsequent commands.

### 5. Create frames first (they define regions)

```bash
pulse-canvas node create --type frame --title "Overview" --data '{"label":"Goals and constraints","color":"#4a90d9"}' --format json
pulse-canvas node create --type frame --title "Research" --data '{"label":"Background research","color":"#9065b0"}' --format json
pulse-canvas node create --type frame --title "Tasks" --data '{"label":"Action items","color":"#d94a4a"}' --format json
```

### 6. Create file nodes with synthesized content

Write meaningful content — not placeholders:

```bash
pulse-canvas node create --type file --title "Overview" --data '{"content":"# Topic Overview\n\n## Goals\n...\n\n## Constraints\n...\n\n## Key Decisions\n..."}' --format json
```

For longer content, create the node first then write via pipe:

```bash
pulse-canvas node create --type file --title "Detailed Analysis" --format json
# Then write to the created node:
pulse-canvas node write <nodeId> --content "$(cat <<'CONTENT'
# Detailed Analysis

## Background
...

## Options Considered
...

## Recommendation
...
CONTENT
)"
```

### 7. Create terminal nodes (only if needed)

Only create terminal nodes when there's a clear execution context:

```bash
pulse-canvas node create --type terminal --title "Dev Server" --data '{"cwd":"/path/to/project"}' --format json
```

Note: Terminal nodes created via CLI have no active PTY session. They serve as placeholders that the user can activate in the canvas UI.

### 8. Verify and summarize

```bash
pulse-canvas context --format json
```

Review the workspace structure and tell the user what was created and why.

## Layout Guidelines

| Region | Purpose | Suggested color |
|--------|---------|-----------------|
| Overview | High-level summary, goals, constraints | `#4a90d9` (blue) |
| Research | Background info, comparisons, references | `#9065b0` (purple) |
| Tasks | Action items, sprint backlog, timeline | `#d94a4a` (red) |
| Implementation | Code, architecture, technical specs | `#4ad97a` (green) |
| Notes | Decisions, meeting notes, open questions | `#d9a54a` (orange) |

## Quality Checklist

Before finishing, verify:

- [ ] Each file node has real content (not just "..." or "TODO")
- [ ] Content is synthesized and actionable, not raw dumps
- [ ] Frames logically group related nodes
- [ ] The canvas tells a story: someone unfamiliar with the topic can understand the structure
- [ ] No more than 4 frames and 8-10 file nodes (keep it focused)

## Anti-patterns

- **Don't create empty nodes** — every file node should have useful content
- **Don't create too many nodes** — a cluttered canvas is worse than no canvas
- **Don't skip research** — a canvas of guesses is not helpful
- **Don't dump raw text** — synthesize, summarize, structure with headings
- **Don't create terminal nodes "just in case"** — only when there's a real execution need
