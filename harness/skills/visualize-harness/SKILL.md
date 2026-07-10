---
name: visualize-harness
description: Use when a maintainer asks to visualize, map, inspect, explain, or compare the repository harness for root, a package, or an app as an interactive HTML reading graph.
---

# Visualize Harness

Generate a standalone graph showing how an agent progressively reads a scope: entry rules, task-triggered sources, concrete evidence, and boundaries.

## Workflow

1. Resolve the requested scope.
   - Root: repository root.
   - Workspace: confirm membership from `pnpm-workspace.yaml` and require its `AGENTS.md`.
2. Read root `AGENTS.md` and `harness/README.md`; then read the scope's `AGENTS.md` and `harness/validate/validation.yaml` when present.
3. Follow only task-relevant routes into Knowledge, Spec, Skills, Source, Types, Tests, and Tools. Do not recursively load every referenced file.
4. Separate evidence honestly:
   - Direct: literal content from loaded entries/files.
   - Progressive: content obtained by following a task-triggered route.
   - Mechanical: current output from tests, scripts, or structure tools.
   - Runtime: behavior observed by running the real app/service.
5. Never read `.env`, secrets, credentials, or real user data for the visualization. Label unexecuted tests and unverified runtime claims explicitly.
6. For a standard root, Engine, or Canvas Workspace map, use the bundled scope scan. For a custom map, build a temporary JSON input and render it with the bundled script.
7. Open the output, click every branch, and report the absolute HTML path plus checks actually run.

## Input

Use this shape; every array must be non-empty and branch IDs must be unique lowercase hyphen-case:

```json
{
  "title": "Engine Harness Reading Graph",
  "subtitle": "How task intent expands into evidence.",
  "scope": "packages/engine",
  "metrics": [{ "value": "9", "label": "built-in plugins" }],
  "entryNodes": [{ "title": "Root AGENTS.md", "detail": "Find the local owner." }],
  "branches": [{
    "id": "public-api",
    "label": "Public API",
    "intent": ["Inspect exported contracts"],
    "sources": ["harness/knowledge/contracts.md", "src/index.ts"],
    "reads": ["Two public barrels"],
    "evidence": ["Four main-barrel omissions"],
    "level": 4
  }],
  "evidenceLevels": [
    { "title": "Entry", "detail": "Rules" },
    { "title": "Knowledge", "detail": "Facts" },
    { "title": "Source", "detail": "Implementation" },
    { "title": "Checks", "detail": "Behavior" }
  ],
  "boundary": "Do not infer unrun checks or read secrets."
}
```

Metrics must come from current commands or files, not copied historical prose. Prefer an existing scope tool such as `describe-engine.mjs` or `describe-canvas.mjs`; otherwise use focused `rg`, file counts, and validation dry-runs.

## Render

Built-in scopes collect current filesystem metrics and provide bilingual reading paths. Choose `en` (default) or `zh`:

```bash
node harness/skills/visualize-harness/scripts/render-harness-graph.mjs \
  --scope canvas-workspace \
  --locale zh \
  --output /tmp/canvas-workspace-harness.html
```

Supported scopes: `root`, `engine`, `canvas-workspace`, and `all`. `all` puts the three built-in scopes into one HTML page with internal tabs:

```bash
node harness/skills/visualize-harness/scripts/render-harness-graph.mjs \
  --scope all \
  --locale zh \
  --output /tmp/harness-all.html
```

The `all` page includes an in-page English/中文 switch. `--locale` sets its initial language; switching keeps the currently selected scope tab.

For a custom map, preserve the original input mode:

```bash
node harness/skills/visualize-harness/scripts/render-harness-graph.mjs \
  --input /tmp/<scope>-harness.json \
  --locale en \
  --output /tmp/<scope>-harness.html
```

The renderer validates the schema, escapes embedded content, creates parent directories, and writes one dependency-free interactive HTML file.
