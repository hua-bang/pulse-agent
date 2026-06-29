# AGENTS.md - packages/pulse-sandbox

> Local entry for `packages/pulse-sandbox`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-sandbox` owns the sandboxed JavaScript execution runtime and `run_js` engine tool adapter. It executes user-provided code in a child process with a restricted Node `vm` context, timeout and memory limits, output capture, and structured execution results.

This package should stay focused on sandbox execution and tool wrapping. CLI-specific command UX belongs in `packages/cli`; engine tool registration policy belongs in the host or engine integration layer.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview and behavior | `README.md` |
| Public exports | `src/index.ts` |
| Executor process management | `src/executor.ts` |
| VM runner behavior | `src/runner.ts` |
| Engine tool adapter | `src/tool.ts` |
| Public result and option types | `src/types.ts` |
| Tests | `src/tool.test.ts` |
| Engine tool contracts | `../engine/AGENTS.md`, `../engine/src/tools/` |
| Documentation routing | `../../harness/skills/doc-governance.md` |
| Validation planning | `../../harness/skills/quality-workflow.md` |

## Local Constraints

- Treat sandbox behavior as security-sensitive. Preserve child-process isolation, timeout handling, memory limits, output clamping, and structured error codes.
- Keep user code execution free of filesystem and network capabilities unless an explicit contract change is approved and tested.
- Keep runner resolution compatible with built `dist/` output and package consumers.
- Public result types and `run_js` input schema are contracts; route changes through `../../harness/skills/contract-coding.md`.
- Add or update tests for changes to policy blocking, timeout/OOM handling, output truncation, globals, or tool schema behavior.

## Common Commands

```bash
pnpm --filter pulse-sandbox test
pnpm --filter pulse-sandbox typecheck
pnpm --filter pulse-sandbox build
```

## Key Files

- `src/index.ts`: public exports for executor, tool adapter, and types.
- `src/executor.ts`: child process lifecycle, limits, runner path resolution, timeout/OOM/internal error handling, and output merging.
- `src/runner.ts`: restricted `vm` context, console capture, code wrapping, and IPC response.
- `src/tool.ts`: Zod-validated `run_js` tool factory.
- `src/types.ts`: execution request/result/error and tool option contracts.
- `src/tool.test.ts`: current focused Vitest coverage for tool forwarding and policy blocking.
