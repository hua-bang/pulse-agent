# Harness Dashboard Tool

## Purpose

Expose the repository harness as a local dashboard that is easy to scan before changing code or docs.

The dashboard derives coverage, missing items, workspace guidance, validation commands, and relationship metadata from existing harness files:

- `harness/profile.yaml`
- `harness/validation.yaml`
- `harness/skills/*.md`
- `harness/tools/*/README.md`
- `pnpm-workspace.yaml`
- workspace `AGENTS.md` and docs referenced by the profile

## Usage

From the repository root:

```bash
node harness/tools/graph-viewer/server.mjs
```

Then open the printed local URL. The dashboard includes:

- overall harness health and coverage, without forcing a workspace selection
- per-workspace harness detail with a dedicated detail rail
- current missing harness items grouped by affected workspace, with collapsible groups and explicit workspace drill-in
- resolved validation commands
- Chinese/English language switcher for easier shared review

Relationship metadata remains available at `/graph.json` for debugging, but it is not part of the main dashboard surface.

For a non-server smoke check:

```bash
node harness/tools/graph-viewer/server.mjs --once
```

## Output

The smoke check prints:

- workspace coverage summary
- relationship node/edge counts
- missing referenced files and harness gaps

## Non-goals

- No LLM inference in the first version.
- No edits to existing harness files.
- No package script or CI integration yet.
