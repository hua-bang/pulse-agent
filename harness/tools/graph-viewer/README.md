# Graph Viewer Tool

## Purpose

Visualize the repository harness as a local graph without adding manual dependency annotations.

The viewer derives nodes and edges from existing harness files:

- `harness/profile.yaml`
- `harness/validation.yaml`
- `harness/skills/*.md`
- `harness/tools/*/README.md`
- workspace `AGENTS.md` and docs referenced by the profile

## Usage

From the repository root:

```bash
node harness/tools/graph-viewer/server.mjs
```

Then open the printed local URL.

For a non-server smoke check:

```bash
node harness/tools/graph-viewer/server.mjs --once
```

## Output

The UI shows:

- workspace coverage
- skills and tools
- validation rules
- missing referenced files
- semantic edges with confidence levels

## Non-goals

- No LLM inference in the first version.
- No edits to existing harness files.
- No package script or CI integration yet.
