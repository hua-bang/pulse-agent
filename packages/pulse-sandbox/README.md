# pulse-sandbox

Sandboxed JavaScript runtime for Pulse Coder. Executes user-provided JS code in an isolated Node.js `vm` context with strict resource limits. Used by the CLI's `run_js` tool.

## How It Works

```
createJsExecutor()
  → spawns child process (runner.ts)
  → runner creates vm.Context with restricted globals
  → wraps code in 'use strict' async IIFE
  → executes with timeout + memory limit
  → returns { ok, result, stdout, stderr, durationMs }
```

### Sandbox Restrictions

The VM context **disables**:
- `require`, `module`, `__filename`, `__dirname`
- `process`, `Buffer`, `global`, `globalThis`
- `fetch`, `WebSocket`, `XMLHttpRequest`
- `setTimeout`, `setInterval` (and their clear counterparts)
- File system and network access

The VM context **provides**:
- `console` (log/error/warn/info/debug — captured to stdout/stderr buffers)
- `JSON`, `Math`, `Date`, `Array`, `Object`, `Map`, `Set`, `Promise`, `RegExp`, etc.
- `input` — the optional input value passed via `JsExecutionRequest`

### Resource Limits

| Limit | Default | Description |
|-------|---------|-------------|
| `timeoutMs` | 2000 | Max execution time before SIGKILL |
| `memoryLimitMb` | 64 | V8 heap limit for child process |
| `maxOutputChars` | 20000 | Combined stdout+stderr truncation |
| `maxCodeLength` | 20000 | Max input code length |

## Exports

| Export | Description |
|--------|-------------|
| `createJsExecutor(options?)` | Creates a `JsExecutor` that spawns isolated child processes |
| `createRunJsTool(options)` | Creates a Zod-validated engine tool wrapping the executor |

## Usage

### As an engine tool

```typescript
import { createJsExecutor, createRunJsTool } from 'pulse-sandbox';

const executor = createJsExecutor({ timeoutMs: 5000 });
const tool = createRunJsTool({ executor });

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
```

### Error Codes

| Code | Trigger |
|------|---------|
| `TIMEOUT` | Execution exceeded `timeoutMs` |
| `OOM` | Child process exceeded `memoryLimitMb` |
| `RUNTIME_ERROR` | Uncaught exception in user code |
| `POLICY_BLOCKED` | Invalid input (empty code, zero timeout, code too long) |
| `INTERNAL` | Unexpected executor failure |

## Build & Test

```bash
pnpm --filter pulse-sandbox build
pnpm --filter pulse-sandbox test
pnpm --filter pulse-sandbox typecheck
```
