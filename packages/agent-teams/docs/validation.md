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

If a consumer's integration behavior changes, also run that consumer's
checks. The real consumers are `apps/teams-cli` + `packages/cli` (classic
surface) and `apps/canvas-workspace` (runtime surface) — NOT
`packages/engine` (its "agent-teams plugin" is orchestrator-based, not a
consumer of this package; see `docs/contracts.md`):

```bash
pnpm --filter @pulse-coder/teams-cli test
pnpm --filter pulse-coder-cli build
pnpm --filter canvas-workspace test
```

## Manual Evidence

For checkpoint, review, handoff, or multi-agent runtime behavior that is hard to unit test, include a concise scenario note and whether the teams preview or canvas integration was exercised.

## Docs-only Changes

If only `AGENTS.md`, `docs/contracts.md`, or `docs/validation.md` changed, no package build/test is required. Check referenced paths and commands instead.
