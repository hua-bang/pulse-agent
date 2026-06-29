# Engine Validation

Run commands from the repository root.

## Default Checks

```bash
pnpm --filter pulse-coder-engine test
pnpm --filter pulse-coder-engine typecheck
```

Use `build` when public exports, package configuration, or generated output behavior changes:

```bash
pnpm --filter pulse-coder-engine build
```

## Escalation

If public APIs, exported types, built-in plugin behavior, or tool contracts change, add relevant consumer checks:

```bash
pnpm --filter pulse-coder-cli test
pnpm --filter @pulse-coder/remote-server build
```

For changes that affect agent teams integration, also consider:

```bash
pnpm --filter pulse-coder-agent-teams test
pnpm --filter pulse-coder-agent-teams typecheck
```

## Manual Evidence

For changes to streaming, abort, clarification, tool execution, or compaction behavior, include a short note describing the scenario covered by tests or the remaining manual risk.

## Docs-only Changes

If only `AGENTS.md`, `docs/contracts.md`, or `docs/validation.md` changed, no package build/test is required. Check referenced paths and commands instead.
