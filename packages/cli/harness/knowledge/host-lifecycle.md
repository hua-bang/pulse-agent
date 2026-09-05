# CLI host lifecycle

Read before changing run/abort/queue behavior, modes, slash commands, sessions, or logging. These contracts apply to Ink and readline unless the text identifies an intentional divergence. Source assembly is mapped in source-layout.md; model selection belongs to model-registry.md, rendering to live-region-bounding.md, and goal policy to goal.md.

## Run, command, and session guards

- The Ink host renders with `exitOnCtrlC: false`; Ctrl+C double-press exit lives in `ink-app.tsx`. Re-enabling Ink's built-in handler would exit on the first press and skip session save.

- CLI interaction modes are exactly the two engine states: `edit` → `setMode('executing')`, `plan` → `setMode('planning')` (see `applyInteractionMode`). `/chat`, `/auto`, `/execute` remain accepted as aliases for edit — do not reintroduce modes without a real behavioral difference backing them.

- Slash command resolution is strictly ordered: built-in > runtime skill > error. Built-ins always win, so a skill cannot shadow a real command; colliding skills are dropped from the palette and stay reachable via `/skills <name> <message>`. Skills reach the composer through the snapshot's `skills` field, published once after engine init.

- `/team`, `/teams`, `/solo`, `/acp` and the `//` passthrough are retired from BOTH hosts (see `RETIRED_COMMANDS` in each). Their modules and the `pulse-coder-acp` dependency are intentionally kept so the capability can return; do not re-add them to `LOCAL_COMMANDS` without also restoring abort support and routing their output through the bridge.

- Esc discards queued input. Anything typed behind a run was meant for the conversation the user is stopping, so `requestStop()` clears the queue and says how many it dropped; draining it in the run's `finally` would fire it milliseconds after telling them the request was cancelled. `runExclusive()` commands (`/compact`) hold no abort controller — Esc there says the command cannot be interrupted rather than claiming a cancellation. Both `runExclusive()` and `runMessage()` must call `drainQueuedInput()`, or input typed during a command is stranded until the next run.

- Bare `/resume` opens a modal picker (snapshot `picker` field, same pattern as clarification) — Ink host only; the readline host keeps the text form, an intentional UI-specific divergence. Session list previews must go through `extractMessageText` (`session.ts`) — context messages carry AI SDK structured content, and `String(content)` renders `[object Object]`. The picker is shared by `/model` via `activePicker` routing in the controller.

- Print mode owns the mutable engine context: append every `onResponse` batch and replace its messages from `onCompacted`, or multi-step tool runs will repeat against stale history.

- The engine does NOT throw on abort: once the signal fires, `loop()` returns the plain sentinel string `'Request aborted.'` as an ordinary result, so an `AbortError` catch never sees an engine-side cancellation. Both hosts MUST check `signal.aborted` after the run resolves and route it to the abort path — otherwise the success path finalizes the partial answer as final, writes a "Done in Xs" summary, prints the sentinel as the model's reply, and persists the cancelled turn. `ink-controller.test.ts` pins both directions.

- `saveSession` writes a temp file and renames over the target. A plain `writeFile` truncates first, so a process killed mid-save loses the whole conversation — never reduce this back to a direct write.

- Signals: the Ink host runs stdin in raw mode, so a local Ctrl+C is a raw byte handled by the app's double-press exit, NOT a signal. `ink-launcher.tsx` registers SIGINT/SIGTERM only to catch externally delivered ones (`kill`, `docker stop`, CI cancel) and routes them to the idempotent `controller.shutdown()`, bounded so a hung save cannot make the CLI ignore SIGTERM. The readline host's handler is guarded against re-entry — an unguarded second Ctrl+C starts a concurrent `saveContext` and exits without waiting for it.

- `EngineLogSink.restore()` must keep awaiting an in-flight rotation (`rotationSettled`): the rename+reopen ride on an async `end()` flush, and resolving mid-swap loses the `.old` swap the caller was told had settled — the rotation spec failed ~50% under full-suite load before this. Also `EngineLogSink`'s write stream MUST keep its `'error'` listener: Node throws on an unhandled stream `'error'` and nothing in the process catches it, so a post-open write failure (disk full, log dir removed) would kill the host mid-run ahead of any save.

- Sessions record their creating `cwd` in metadata, and every listing path (`/sessions`, `/search`, the `/resume` picker, `--continue`, index/prefix resolution) is scoped to it. Sessions written before the field existed have no `cwd` and must keep passing the filter — never make the check exclusive.

- Startup failures must write to `process.stderr` directly (see `main().catch`): with `EngineLogSink` installed, `console.error` is captured into the log file and a crash before render is otherwise silent. This package has no typecheck script — a missing cross-package export (e.g. an engine re-export) surfaces only at runtime, so smoke-launch after wiring new engine imports.

- Usage counters are per-conversation state: `/new`, `/clear`, `/resume` and deleting the active session must all call `resetUsageCounters()`, or the status line keeps reporting the previous conversation's tokens.

- Slash command changes should preserve session persistence, queued input, abort handling, and the clarification flow.

- Known divergence, preserved as-is by the structure refactor: in the READLINE host a direct `/<skill-name> <message>` invocation transforms the message but then still falls through to `handleCommand`, which reports the command unknown — the transformed skill message never runs (`routeSlashInput` in `src/readline/command-surface.ts`, NOTE comment). The Ink host resolves the same input correctly; `/skills <name> <message>` works on both. Fix deliberately deferred: it is a behavior change and needs its own test.

Print-mode output is owned by src/print/print-mode.ts: stdout carries only the answer, while console logging is redirected to stderr. Clarification and session/task-list metadata must survive host changes.
