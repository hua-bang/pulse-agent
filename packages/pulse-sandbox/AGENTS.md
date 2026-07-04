# AGENTS.md - packages/pulse-sandbox

> Local entry for `packages/pulse-sandbox`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-sandbox` owns the sandboxed JavaScript execution runtime and `run_js` engine tool adapter. It executes user-provided JavaScript in a forked child process, runs it inside a restricted Node `vm` context, applies timeout/memory/code/output limits, captures console output, and returns structured execution results.

This package should stay focused on sandbox execution and tool wrapping. CLI-specific command UX belongs in `packages/cli`; engine tool registration policy belongs in the host or engine integration layer.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview and scripts | `README.md`, `package.json` |
| Public exports | `src/index.ts` |
| Public result and option types | `src/types.ts` |
| Executor process management, limits, runner resolution | `src/executor.ts` |
| VM globals, console capture, code wrapping, IPC response | `src/runner.ts` |
| Engine tool adapter | `src/tool.ts` |
| Tests | `src/tool.test.ts` |
| CLI integration points | `../cli/src/index.ts`, `../cli/src/ink-controller.ts` |
| Engine tool contracts | `../engine/AGENTS.md`, `../engine/src/tools/index.ts` |
| Local validation | `harness/validate/validation.yaml` |

## Local Constraints

- Treat sandbox behavior as security-sensitive. Preserve child-process isolation, timeout handling, memory limits, output clamping, and structured error codes.
- Current VM globals intentionally hide `require`, `process`, `module`, `exports`, `Buffer`, `fetch`, `WebSocket`, and `EventSource`; string and wasm code generation are disabled through `vm.createContext`.
- Current VM globals expose `input`, a captured `console`, standard JavaScript globals, `globalThis`/`global` bound to the sandbox object, and timer functions. Do not document timers as blocked unless the runner changes.
- Keep user code execution free of direct filesystem and network capabilities unless an explicit contract change is approved and tested.
- Keep runner resolution compatible with built `dist/` output and package consumers.
- Public result types and `run_js` input schema are contracts; use local validation plus the root impact overlay when engine or CLI consumers are affected.
- The CLI imports `createJsExecutor` and `createRunJsTool` from `pulse-sandbox/src`; coordinate CLI and sandbox changes when changing public exports or tool behavior.
- Add or update tests for changes to policy blocking, timeout/OOM handling, output truncation, VM globals, runner path resolution, or tool schema behavior.

## Common Commands

```bash
pnpm --filter pulse-sandbox test
pnpm --filter pulse-sandbox typecheck
pnpm --filter pulse-sandbox build
```

## Key Files

- `src/index.ts`: public exports for executor, tool adapter, and types.
- `src/executor.ts`: child process lifecycle, limits, runner path resolution, timeout/OOM/internal error handling, and output merging.
- `src/runner.ts`: restricted `vm` context, sandbox global list, console capture, code wrapping, and IPC response.
- `src/tool.ts`: Zod-validated `run_js` tool factory.
- `src/types.ts`: execution request/result/error and tool option contracts.
- `src/tool.test.ts`: current focused Vitest coverage for tool forwarding and policy blocking.
