# pulse-sandbox

Sandboxed JavaScript runtime for Pulse Coder. Executes user-provided JS code in an isolated Node.js `vm` context with strict resource limits. Used by the CLI's `run_js` tool.

## How It Works

```
createJsExecutor()
  → spawns child process (runner.ts)
  → runner creates vm.Context with restricted globals
  → wraps code in 'use strict' async IIFE
  → executes with timeout + memory limit
  → returns { ok, result, stdout, stderr, error, durationMs, outputTruncated }
```

The result is sent back over Node IPC. `stdout`/`stderr` are merged from the proxied `console` inside the VM and the child process's own streams.

### Sandbox Restrictions

The VM context **disables** (set to `undefined`):
- `require`, `module`, `exports`
- `process`, `Buffer`
- `fetch`, `WebSocket`, `EventSource`
- String and wasm code generation (`eval`, `new Function(...)`, `WebAssembly`) via `vm.createContext({ codeGeneration: { strings: false, wasm: false } })`

File system and network access are consequently unavailable: there is no `fs` global, `require` is blocked, and the network globals above are undefined.

The VM context **provides**:
- `console` (log/error/warn/info/debug — captured to stdout/stderr buffers)
- `JSON`, `Math`, `Date`, `Array`, `Object`, `Map`, `Set`, `Promise`, `RegExp`, etc.
- `globalThis` and `global` — both bound to the sandbox object itself
- `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`
- `input` — the optional input value passed via `JsExecutionRequest`

> The exact global list lives in `src/runner.ts` (`buildSandbox`). Timers and `globalThis`/`global` are intentionally exposed, not blocked. See `AGENTS.md` for the security rationale.

### Resource Limits

| Limit | Default | Description |
|-------|---------|-------------|
| `timeoutMs` | 2000 | Max execution time before the child is killed with SIGKILL |
| `memoryLimitMb` | 64 | V8 heap limit for the child process (`--max-old-space-size`) |
| `maxOutputChars` | 20000 | Per-stream truncation limit; applied independently to stdout and stderr, so combined output may reach 2x this value |
| `maxCodeLength` | 20000 | Max input code length |

When truncation occurs on either stream, `outputTruncated` is set to `true` on the result.

## Exports

Value exports:

| Export | Description |
|--------|-------------|
| `createJsExecutor(options?)` | Creates a `JsExecutor` that spawns isolated child processes |
| `createRunJsTool(options)` | Creates a Zod-validated engine tool wrapping the executor |

Type re-exports (from `src/types.ts`):

| Type | Description |
|------|-------------|
| `JsExecutionRequest` | Executor input: `code`, optional `input`, optional `timeoutMs` |
| `JsExecutionResult` | Executor output: `ok`, `result?`, `stdout`, `stderr`, `error?`, `durationMs`, `outputTruncated` |
| `JsExecutionError` | `{ code: JsExecutionErrorCode; message: string }` |
| `JsExecutionErrorCode` | Union of error codes (see Error Codes) |
| `JsExecutor` | `{ execute(request): Promise<JsExecutionResult> }` |
| `JsExecutorOptions` | Optional `timeoutMs` / `memoryLimitMb` / `maxOutputChars` / `maxCodeLength` |
| `RunJsToolInput` | Tool input: `code`, optional `input`, optional `timeoutMs` |
| `RunJsToolOptions` | Tool factory options: `executor` (required), optional `name` / `description` overrides |
| `RunJsToolOutput` | Alias of `JsExecutionResult` |

## Usage

### As an engine tool

```typescript
import { createJsExecutor, createRunJsTool } from 'pulse-sandbox';

const executor = createJsExecutor({ timeoutMs: 5000 });
const tool = createRunJsTool({ executor });

// The tool name/description default to 'run_js' and a built-in description;
// override them when registering under a different key:
// createRunJsTool({ executor, name: 'eval_js', description: '...' });

// Register with engine
const engine = new Engine({ tools: { run_js: tool } });
```

### Standalone

```typescript
import { createJsExecutor } from 'pulse-sandbox';

const executor = createJsExecutor();

const result = await executor.execute({
  code: `
    const sum = input.numbers.reduce((a, b) => a + b, 0);
    console.log('Sum:', sum);
    return { sum };
  `,
  input: { numbers: [1, 2, 3, 4, 5] },
});

// result.ok === true
// result.stdout === 'Sum: 15\n'
// result.result === { sum: 15 }
// result.outputTruncated === false
```

### Error Codes

| Code | Trigger |
|------|---------|
| `TIMEOUT` | Execution exceeded `timeoutMs` (child killed with SIGKILL) |
| `OOM` | Child process exceeded `memoryLimitMb` (SIGABRT or heap-out-of-memory) |
| `RUNTIME_ERROR` | Uncaught exception in user code |
| `POLICY_BLOCKED` | Invalid input (empty/whitespace code, non-positive or non-integer timeout, code exceeding `maxCodeLength`) |
| `INTERNAL` | Unexpected executor failure (fork error, IPC failure, abnormal exit) |

## Build & Test

```bash
pnpm --filter pulse-sandbox build
pnpm --filter pulse-sandbox test
pnpm --filter pulse-sandbox typecheck
```
