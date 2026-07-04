# Engine Validate

Run commands from the repository root.

## Default Checks

```bash
pnpm --filter pulse-coder-engine test
pnpm --filter pulse-coder-engine typecheck
```

The local `validation.yaml` intentionally has one default rule. It answers the local package question: "what should run when engine source or package config changes?"

Use `build` as an extra smoke check when package exports, package config, or generated output behavior changes:

```bash
pnpm --filter pulse-coder-engine build
```

## Impact Checks

For public API, built-in plugin, tool contract, or runtime-loop changes, apply the root impact overlay in `../../../harness/validate/validation.yaml` and pick relevant consumer checks such as CLI, remote-server, or canvas-workspace.

Keep those impact decisions out of the local YAML until a runner exists and the semantics are stable.

## Manual Evidence

For streaming, abort, clarification, tool execution, timeout, or compaction changes, report the scenario covered by tests or the remaining manual risk.

## Docs-Only Changes

If only `AGENTS.md`, `README.md`, or files under `harness/` changed, package build/test is not required. Check referenced paths and commands instead.
