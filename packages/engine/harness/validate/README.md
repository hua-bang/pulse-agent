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

Four kinds of engine change escalate to consumers. Each maps to a named rule in the root overlay `../../../../harness/validate/validation.yaml`; the runner prints the matching rule's commands as a reminder (never auto-run — the human decides which kind this change is). To know *who* breaks and *why*, see `../knowledge/contracts.md` "Known Consumers".

| Change kind | Trigger criterion | Root rule |
|---|---|---|
| Public API surface | `src/index.ts`, `src/built-in/index.ts` (both barrels), or `shared/` types change | `enginePublicApiChange` |
| Built-in plugin set | add / remove / reorder in `src/built-in/**` | `engineBuiltInPluginChange` |
| Core loop behavior | streaming / retry / abort / compaction in `src/core/**`, `src/context/**`, `src/ai/**` | `engineCoreLoopChange` |
| Built-in tool contract | `Tool<Input,Output>` / `ToolExecutionContext` shape in `src/tools/**` | `engineToolSchemaChange` |

Escalation stays reminder-only until the runner supports path-scoped matching; today any engine change prints all four reminders and you pick.

## Manual Evidence

For streaming, abort, clarification, tool execution, timeout, or compaction changes, report the scenario covered by tests or the remaining manual risk.

## Docs-Only Changes

If only `AGENTS.md`, `README.md`, or files under `harness/` changed, package build/test is not required. Check referenced paths and commands instead.
