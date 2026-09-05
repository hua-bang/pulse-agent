# Engine Validate

Run commands from the repository root.

## Default Checks

```bash
pnpm --filter pulse-coder-engine test
pnpm --filter pulse-coder-engine typecheck
```

The local `validation.yaml` owns default package checks and the built-in registry check. It answers the local package question: "what should run when engine source or package config changes?"

Use `build` as an extra smoke check when package exports, package config, or generated output behavior changes:

```bash
pnpm --filter pulse-coder-engine build
```

## Impact Checks

Four kinds of engine change escalate to consumers. Each maps to a named rule in the root overlay `../../../../harness/validate/validation.yaml`; the runner prints the matching rule's commands as a reminder (never auto-run — the human decides which kind this change is). To know *who* breaks and *why*, see `../knowledge/contracts.md` "Known Consumers".

| Change kind | Trigger criterion | Root rule |
|---|---|---|
| Public API surface | Package exports, their barrels, or exported declaration owners change: Engine, shared, plugin, built-in, orchestrator, config, core, AI, context, tools | `enginePublicApiChange` |
| Built-in plugin set | add / remove / reorder in `src/built-in/**` | `engineBuiltInPluginChange` |
| Core loop behavior | streaming / retry / abort / compaction in `src/core/**`, `src/context/**`, `src/ai/**` | `engineCoreLoopChange` |
| Built-in tool contract | `Tool<Input,Output>` / `ToolExecutionContext` shape in `src/tools/**` | `engineToolSchemaChange` |

The runner matches explicit root escalation paths and prints only the relevant reminders, including their triggering paths. A signature can change at its declaration without a barrel edit, so public-API selectors cover declaration owners as well as entry files. Execution remains manual: a matching path identifies possible impact, not proof that the public contract changed semantically.

## Manual Evidence

For streaming, abort, clarification, tool execution, timeout, or compaction changes, report the scenario covered by tests or the remaining manual risk.

## Docs-Only Changes

If only `AGENTS.md`, `README.md`, or files under `harness/` changed, package build/test is not required. Check referenced paths and commands instead.

## TypeScript and Coverage Boundaries

Engine and ACP dropped rootDir from their tsconfigs because root path aliases can import another package's source and trigger TS6059. rootDir controls emit layout; tsc --noEmit and tsup do not require it. Preserve that choice rather than restoring rootDir as a cosmetic cleanup. Plugin-kit's separate remaining boundary is documented by that package.

The engine orchestrator module has no dedicated specs in the current source tree; passing tests elsewhere does not prove its behavior. Use its contract guidance and relevant consumer/manual evidence when modifying that boundary.

Persistence tests must isolate both session-state and user-registry directories. The role-soul registry base is captured from homedir at module import, independently of PULSE_CODER_SOUL_STATE_DIR; its suite mocks homedir before importing the plugin and writes under a temporary fixture. Setting only the state directory previously let tests write into the real user soul registry.
