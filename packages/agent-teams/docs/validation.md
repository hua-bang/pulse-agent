# Agent Teams Validation

Run commands from the repository root.

## Default Checks

```bash
pnpm --filter pulse-coder-agent-teams test
pnpm --filter pulse-coder-agent-teams typecheck
```

Use build when package exports or runtime entrypoints change:

```bash
pnpm --filter pulse-coder-agent-teams build
```

## Escalation

If runtime protocol, exported APIs, task state shape, or team lifecycle behavior changes, include consumers as relevant:

```bash
pnpm --filter @pulse-coder/teams-cli build
pnpm --filter canvas-workspace typecheck
```

If engine integration behavior changes, also consider:

```bash
pnpm --filter pulse-coder-engine test
```

## Manual Evidence

For checkpoint, review, handoff, or multi-agent runtime behavior that is hard to unit test, include a concise scenario note and whether the teams preview or canvas integration was exercised.

## Docs-only Changes

If only `AGENTS.md`, `docs/contracts.md`, or `docs/validation.md` changed, no package build/test is required. Check referenced paths and commands instead.
