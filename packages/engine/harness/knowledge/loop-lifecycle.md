# Loop Lifecycle

One `Engine.run()` → `loop()` turn, end to end. Verified against `src/core/loop.ts`, `src/Engine.ts`, `src/ai/index.ts`, `src/config/index.ts`.

## One Turn, End to End

1. Abort check at entry — exit immediately if the external signal is already aborted.
2. Pre-loop compaction check (`maybeCompactContext`); on success fire `onCompacted` and restart the iteration. Uses the shared attempt counter (see `architecture.md` Runtime Invariants).
3. `beforeRun` hooks (once, in `Engine.run()`) — may replace tools/systemPrompt.
4. Each iteration: `beforeLLMCall` hooks (run sequentially, retries included).
5. Tool wrapping, fixed order: read/ls dedup wrapper first, then the beforeToolCall/afterToolCall hook wrapper; active tool executions tracked in a map for hung-tool diagnostics.
6. LLM call setup: fresh AbortController, arm first-chunk timer and total-call timer.
7. `streamTextAI` streams chunks: text-delta → onText; tool-call → onToolCall (+ hook, fire-and-forget); tool-result → onToolResult; tool-input-* → UI feedback.
8. `Promise.race([llmCompletion, llmWaitAbort])` — timeout handlers and caller aborts reject the wait promise; first chunk clears the first-chunk timer; a finally block disposes all timers.
9. `afterLLMCall` hooks — fire on success AND on the error path (with `error` populated).
10. finishReason dispatch:
    - `stop` → return text (or continue if empty).
    - `length` → disambiguate output-cap vs true overflow (`inputTokens >= budget*0.8`); output-cap just continues; true overflow force-compacts, bounded by the shared counter.
    - `content-filter` → log with context, return warning.
    - `error` → return failure.
    - `tool-calls` → continue unless `totalSteps >= MAX_STEPS` (500).
11. On thrown error: abort check → `afterLLMCall` (if the call had started) → retry policy (below) or formatted error return.
12. `afterRun` hooks (once, in `Engine.run()`).

## Timeout & Abort Model

| Timer | Default | Env knob | Cleared by |
|---|---|---|---|
| First-chunk | 180 000 ms | `LLM_FIRST_CHUNK_TIMEOUT_MS` | first stream chunk |
| Total call | 600 000 ms | `LLM_CALL_TIMEOUT_MS` | call completion |

Both route through one `handleTimeout()`: mark an `LLMTimeoutError` (`timeoutReason: 'first-chunk' | 'total'`), abort the per-call controller, reject the race. If the timeout fires while a tool is executing, the error carries `activeTool` ({name, startedAt, inputPreview}) so hung tools are identifiable — this is the guard from the "classify hung tool timeout errors" fix.

External `AbortSignal` propagates to both the LLM call and `ToolExecutionContext`; abort is re-checked at loop entry, around compaction, and after the LLM call.

## Retry & Error Classification

- Retryable (`isRetryableError`): HTTP 429/500/502/503, or message containing "no output generated" (upstream opened a stream but produced nothing).
- Backoff: `min(2000 * 2^(errorCount-1), 30000)` ms — 2s, 4s, 8s…
- Cap: `MAX_ERROR_COUNT = 3`, then "Failed after 3 errors: …".
- Everything else (auth, malformed request…) returns a formatted error immediately.

## Exit Conditions

| Exit | Caller receives |
|---|---|
| `stop` with text | the text |
| `tool-calls` at `MAX_STEPS` (500) | "Max steps reached, task may be incomplete." |
| true overflow, compactions exhausted (cap 2) | "Context limit reached." or partial text |
| `content-filter` | upstream-filter warning |
| `error` finish / non-retryable throw | formatted upstream error |
| retries exhausted (3) | "Failed after 3 errors: {last}" |
| external abort (any point, incl. backoff sleep) | "Request aborted." |
