# AGENTS.md - packages/cli

> Local entry for `packages/cli`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-cli` owns the interactive terminal host on top of `pulse-coder-engine`. It handles the default Ink UI, the readline fallback UI, the `-p/--print` non-interactive mode, session persistence, slash commands (including `/<skill-name>` invocation), clarification input, model switching, memory integration, task-list binding, goal-driven continuation (`/goal`), and host tool registration (`run_js` plus the experimental Pulse Canvas capability adapter).

CLI behavior should remain a host layer over the engine. Engine runtime behavior belongs in `packages/engine`; ACP protocol behavior belongs in `packages/acp`; team coordination behavior belongs in `packages/agent-teams`; sandbox execution behavior lives locally in `src/tools/sandbox/` (executor + forked `runner` — built as `dist/runner.cjs`).

Source layout: entry dispatch at the root (`src/index.ts`, `src/ui-mode.ts`); one directory per host surface (`src/ink/`, `src/readline/`, `src/print/`); host-shared modules grouped by role; tests beside their modules; source files stay under ~300 lines. Full map + module-cluster rules: `harness/knowledge/source-layout.md`.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview and scripts | `README.md`, `package.json` |
| UI mode / CLI flag parsing | `src/ui-mode.ts` |
| Default Ink host path | `src/ink/ink-launcher.tsx`, `src/ink/ink-controller.ts` (+ `controller-*.ts`, `tool-payload.ts`), `src/ink/ink-app.tsx` (+ `ink-types.ts`, `composer-*.ts`, `app-*.ts(x)`, `use-composer-layout.ts`, `transcript-event.tsx`), `src/ink/ink-ui-bridge.ts` (+ `bridge-surface.ts`, `live-run.ts`, `event-log.ts`, `event-text.ts`, `tool-*-format.ts`) |
| Readline fallback host path | `src/readline/readline-host.ts` (+ `command-surface.ts`, `host-commands.ts`, `host-context.ts`, `agent-turn.ts`), `src/readline/tui-renderer.ts` (+ `tui-format.ts`, `tui-spinner.ts`) |
| Non-interactive `-p` mode | `src/print/print-mode.ts` |
| Markdown-to-ANSI rendering | `src/terminal/markdown.ts` |
| Prompt history persistence | `src/session/history-store.ts` |
| Engine log layer (`/debug`) | `src/shared/log-sink.ts` |
| Model registry (`/model`, `--model`) | `src/models/model-registry.ts` (load/merge), `src/models/model-spec.ts` (types + spec resolution) |
| Model → engine run options (shared) | `src/models/model-run-options.ts` |
| `@` file references | `src/shared/file-reference.ts` |
| User preferences (last model) | `src/models/preferences.ts` |
| Terminal width / cursor stepping | `src/terminal/text-width.ts` |
| Input handling | `src/shared/input-manager.ts` |
| Sessions | `src/session/session.ts`, `src/commands/session-commands.ts` |
| Skills and worktree slash commands | `src/commands/skill-commands.ts`, `src/readline/readline-host.ts`, `src/ink/ink-controller.ts` |
| Retired team/ACP modules (unwired) | `src/commands/team-commands.ts`, `src/commands/acp-commands.ts` |
| Memory integration | `src/shared/memory-integration.ts` |
| Goal integration (`/goal`) | `harness/knowledge/goal.md`, `src/shared/goal-integration.ts`, `src/ink/controller-goal.ts` (host IO), `src/ink/controller-run.ts` (`runSingleTurn` + `startGoalLoop`), `src/ink/controller-commands.ts` (goal case); state machine in plugin-kit `src/goal/runner.ts` |
| Host tool registration | `src/tools/runtime-tools.ts`, `src/tools/canvas-runtime-tools.ts`, `src/tools/sandbox/`, `../canvas-cli/AGENTS.md` |
| Harbor/SWE-bench evaluation | `harness/tools/harbor/README.md`, `harness/tools/harbor/pulse_agent.py` |
| Focused behavior tests | `src/**/*.test.ts` (beside the module under test) |
| Ink frame height / terminal paint | `src/ink/ink-app.render.test.tsx`, `src/ink/ink-app.screen.test.tsx` |

## Local Constraints

- Keep CLI-specific state and UI behavior in this package; do not push UI concerns into the engine.
- Keep command behavior aligned between the Ink controller and the readline fallback unless a change is intentionally UI-specific.
- Default startup selects Ink via `src/ui-mode.ts`; `PULSE_CODER_UI=readline` is the fallback path.
- Ink transcript model: `InkUiBridge.events` is append-only and rendered via Ink `<Static>` (printed once into terminal scrollback). Never mutate an already-emitted event — stream into `liveText`/`liveTools` and finalize on boundaries (tool call, tool result, run end, abort).
- The Ink host renders with `exitOnCtrlC: false`; Ctrl+C double-press exit lives in `ink-app.tsx`. Re-enabling Ink's built-in handler would exit on the first press and skip session save.
- CLI interaction modes are exactly the two engine states: `edit` → `setMode('executing')`, `plan` → `setMode('planning')` (see `applyInteractionMode`). `/chat`, `/auto`, `/execute` remain accepted as aliases for edit — do not reintroduce modes without a real behavioral difference backing them.
- `@` references expand at submit time in BOTH hosts (`runMessage` Ink, `executeAgentTurn` readline): raw text stays in the transcript, contents are appended below; expansion is bounded (bytes/attachment count/dir entries) and refuses binaries and workspace escapes. Image refs (`.png/.jpg/.jpeg/.gif/.webp`) are vision input (AI SDK image parts via `buildUserContent`, 5MB cap), never text. Detail: `harness/knowledge/file-references.md`.
- Slash command resolution is strictly ordered: built-in > runtime skill > error. Built-ins always win, so a skill cannot shadow a real command; colliding skills are dropped from the palette and stay reachable via `/skills <name> <message>`. Skills reach the composer through the snapshot's `skills` field, published once after engine init.
- `/team`, `/teams`, `/solo`, `/acp` and the `//` passthrough are retired from BOTH hosts (see `RETIRED_COMMANDS` in each). Their modules and the `pulse-coder-acp` dependency are intentionally kept so the capability can return; do not re-add them to `LOCAL_COMMANDS` without also restoring abort support and routing their output through the bridge.
- `/model` exists on BOTH hosts over the same registry and resolver; only the surface differs (Ink modal picker vs a printed indexed list plus `/model <index|spec|reset>`). A numeric argument in the readline host is always an index — never let it fall through to the lenient resolver, which would accept a model literally named `"1"`.
- Esc discards queued input. Anything typed behind a run was meant for the conversation the user is stopping, so `requestStop()` clears the queue and says how many it dropped; draining it in the run's `finally` would fire it milliseconds after telling them the request was cancelled. `runExclusive()` commands (`/compact`) hold no abort controller — Esc there says the command cannot be interrupted rather than claiming a cancellation. Both `runExclusive()` and `runMessage()` must call `drainQueuedInput()`, or input typed during a command is stranded until the next run.
- Bare `/resume` opens a modal picker (snapshot `picker` field, same pattern as clarification) — Ink host only; the readline host keeps the text form, an intentional UI-specific divergence. Session list previews must go through `extractMessageText` (`session.ts`) — context messages carry AI SDK structured content, and `String(content)` renders `[object Object]`. The picker is shared by `/model` via `activePicker` routing in the controller.
- Per-model `contextWindow` (models.json) must flow through `modelRunOptions()` into BOTH the run options and `compactContext` — the status-line ctx% denominator and the engine's compaction trigger/target must never diverge.
- Print mode owns the mutable engine context: append every `onResponse` batch and replace its messages from `onCompacted`, or multi-step tool runs will repeat against stale history.
- The engine does NOT throw on abort: once the signal fires, `loop()` returns the plain sentinel string `'Request aborted.'` as an ordinary result, so an `AbortError` catch never sees an engine-side cancellation. Both hosts MUST check `signal.aborted` after the run resolves and route it to the abort path — otherwise the success path finalizes the partial answer as final, writes a "Done in Xs" summary, prints the sentinel as the model's reply, and persists the cancelled turn. `ink-controller.test.ts` pins both directions.
- Both hosts build engine run options through `buildModelRunOptions()` (`model-run-options.ts`). `model-registry.ts` stays engine-free so its tests stay fast; the provider wiring lives in the shared module so a provider-bound spec cannot reach the engine with a connection on one host and without it on the other.
- `resolveModelSpec` never returns null (a bare id always parses) — that leniency is right for a spec the user just typed and wrong for the silent startup restore, which uses `resolveKnownModelSpec` instead. A `provider:model` spec whose provider has left models.json must fail there, not come back as the literal id `"provider:model"`.
- `saveSession` writes a temp file and renames over the target. A plain `writeFile` truncates first, so a process killed mid-save loses the whole conversation — never reduce this back to a direct write.
- Signals: the Ink host runs stdin in raw mode, so a local Ctrl+C is a raw byte handled by the app's double-press exit, NOT a signal. `ink-launcher.tsx` registers SIGINT/SIGTERM only to catch externally delivered ones (`kill`, `docker stop`, CI cancel) and routes them to the idempotent `controller.shutdown()`, bounded so a hung save cannot make the CLI ignore SIGTERM. The readline host's handler is guarded against re-entry — an unguarded second Ctrl+C starts a concurrent `saveContext` and exits without waiting for it.
- `EngineLogSink.restore()` must keep awaiting an in-flight rotation (`rotationSettled`): the rename+reopen ride on an async `end()` flush, and resolving mid-swap loses the `.old` swap the caller was told had settled — the rotation spec failed ~50% under full-suite load before this. Also `EngineLogSink`'s write stream MUST keep its `'error'` listener: Node throws on an unhandled stream `'error'` and nothing in the process catches it, so a post-open write failure (disk full, log dir removed) would kill the host mid-run ahead of any save.
- models.json is provider-granular and committable: provider entries carry `baseUrl` + `apiKeyEnv` (an env var NAME); inline `apiKey` values are ignored with a warning — never let secrets into this file (root AGENTS §7). Provider-bound choices build their connection via the engine's `buildProvider(type, {baseURL, apiKey})` inside `modelRunOptions()`.
- Provider entries may opt into `promptCacheKey: true`: both interactive hosts then send a stable per-session key (SHA-256 of `provider:model:sessionId`, `model-run-options.ts`) that the engine forwards as OpenAI `prompt_cache_key` — cache-node ROUTING AFFINITY for multi-upstream gateways, not cache isolation, so `/clear` keeps the session's key and rotation buys nothing. The provider is the SSOT for the flag (`applyProvider` drops a stale home-scope opt-in on rebase), print mode has no session and never sends one, and the engine's Claude path filters the key out.
- Sessions record their creating `cwd` in metadata, and every listing path (`/sessions`, `/search`, the `/resume` picker, `--continue`, index/prefix resolution) is scoped to it. Sessions written before the field existed have no `cwd` and must keep passing the filter — never make the check exclusive.
- Startup model precedence is `--model` > persisted last choice (`preferences.ts`) > models.json `"default": true` > engine env default. Only an explicit user switch persists; a `--model` flag never does. A persisted spec that no longer resolves warns and falls back rather than failing.
- Sessions additionally record the model they were saved under (`metadata.model`, via `setModelSpecProvider`) and BOTH hosts restore it after `loadContext` on `/resume` and `--continue` — a resumed conversation continues on the model it was actually using. The restore is silent: it never writes the global last-model preference (that records explicit choices only), `--model` still pins the process, and an unresolvable spec warns and keeps the current model. Note the global-preference persistence itself (`preferences.ts`) remains Ink-only; the readline host restores per-session models but does not persist a global last choice.
- The registry loads from BOTH `~/.pulse-coder/models.json` and `<cwd>/.pulse-coder/models.json` and merges them (project wins per provider name and per `provider:model` id; home models referencing a redefined provider are rebased onto the project connection). A home-only setup must keep working from any directory — do not reduce this back to a single-scope lookup.
- Startup failures must write to `process.stderr` directly (see `main().catch`): with `EngineLogSink` installed, `console.error` is captured into the log file and a crash before render is otherwise silent. This package has no typecheck script — a missing cross-package export (e.g. an engine re-export) surfaces only at runtime, so smoke-launch after wiring new engine imports.
- Multi-character `useInput` chunks are pastes (or coalesced typing) and must be inserted literally — never interpreted as Enter/Tab; bracketed paste additionally arrives via Ink's `usePaste` channel.
- The Ink host renders with `patchConsole: false`: `EngineLogSink` owns `console.*` (installed before engine init) and routes it to `~/.pulse-coder/logs/cli.log` + the `/debug` policy (errors surface as dim lines; warns dedupe per unique text per session; info/debug only with `/debug on`, `--verbose`, or `--verbose`). Never write to stdout directly from Ink-host code paths — it tears the frame; log via `console.*` (captured) or the bridge.
- Tool traces are gray one-line summaries by default (`label · N lines/matches`, single-line output inlined, structured output yields NO summary — never a JSON dump); failures stay red with the error inline. `Ctrl+O` toggles content previews and, per the Static model, affects only future traces.
- Assistant text is two-tier: segments finalized because a tool call started are narration (`status: 'info'`, rendered gray, no markdown); only the segment that ends a run renders bright with markdown. The status line's TEXT stays stable during a run (`Running agent · <elapsed>`) — never write per-tool churn into `status`.
- Terminal text math goes through `src/terminal/text-width.ts`: layout truncation measures DISPLAY COLUMNS (CJK/emoji are 2 wide) and cursor movement/deletion steps whole CODE POINTS. `String.length` is wrong for both — never clamp or step by it.
- Usage counters are per-conversation state: `/new`, `/clear`, `/resume` and deleting the active session must all call `resetUsageCounters()`, or the status line keeps reporting the previous conversation's tokens.
- The Ink host renders with `incrementalRendering: true`: Ink's default writer erases and repaints the ENTIRE live block on every frame (measured: ~2x the lines and bytes of the incremental writer over a streaming answer), and at 30fps that repaint of the status line and bordered composer is visible as shimmer. `src/ink/ink-app.screen.test.tsx` pins that the incremental writer paints the same screen as the default one.
- A live region that shrinks must be compensated by matching `<Static>` output, or the composer walks UP the screen and leaves dead rows below it. Ink writes static output in place of the erased live block, so the normal finalize-into-transcript path is already neutral — `src/ink/ink-app.screen.test.tsx` emulates a terminal across a bridge-driven run and fails if the composer jumps up more than a row. Do not "fix" this with reserved padding: holding a high-water height pins the composer mid-run but voids the screen and produces a far bigger jump when the reservation is released.
- Everything rendered BELOW `<Static>` must be bounded by terminal size on BOTH axes, and the axes are coupled — a row window is only correct if it either truncates on columns or charges each line its wrapped height. A frame taller than the viewport makes Ink wipe the screen and replay the whole transcript on EVERY frame until it shrinks back, which at streaming rate is the terminal flicker. `src/ink/ink-app.render.test.tsx` pins the frame height against a mock TTY. Detail + current bounds: `harness/knowledge/live-region-bounding.md`.
- Session files live under `~/.pulse-coder/sessions`; keep local runtime data out of source control and preserve session task-list metadata.
- Slash command changes should preserve session persistence, queued input, abort handling, and the clarification flow.
- This package currently has no `typecheck` script; do not document or rely on `pnpm --filter pulse-coder-cli typecheck` until `package.json` adds it.
- `src/tools/runtime-tools.ts` is the shared tool assembly for both UI hosts. Keep Ink
  and readline on this entry so `run_js` and live-app capabilities cannot drift.
- Live-app capability tools are absent by default; expose them only when
  `PULSE_CODER_EXPERIMENTAL_APP_RUNTIME=1`. The Canvas host separately requires
  its `agent-runtime-control` flag, so both sides opt into the hidden feature.
- When live-app capability tools are registered, their descriptions and the
  bundled Pulse Canvas skill must route the agent to native tools first;
  `pulse-canvas runtime` is the fallback for hosts without those tools. Both
  entries share `@pulse-coder/canvas-cli/core`; do not fork transport policy.
- `run_js` registration imports `src/tools/sandbox/index.js`; `src/tools/sandbox/runner.ts` is never imported — it is the fork target `resolveRunnerPath()` locates next to the built bundle (`dist/runner.cjs`), so keep the tsup `runner` entry in sync. The executor↔runner IPC wire types live in `src/tools/sandbox/protocol.ts`, shared by both sides.
- Known divergence, preserved as-is by the structure refactor: in the READLINE host a direct `/<skill-name> <message>` invocation transforms the message but then still falls through to `handleCommand`, which reports the command unknown — the transformed skill message never runs (`routeSlashInput` in `src/readline/command-surface.ts`, NOTE comment). The Ink host resolves the same input correctly; `/skills <name> <message>` works on both. Fix deliberately deferred: it is a behavior change and needs its own test.
- `/goal` state machine lives in plugin-kit (`runGoalLoop`); the CLI only injects IO (`runOnce`/`confirm`/`verify`). Goal context is prompt-FREE (system stays byte-stable → provider caches keep hitting); completion is verified then ALWAYS user-confirmed. Detail: `harness/knowledge/goal.md`.
- Contract changes with engine, ACP, teams, or plugin-kit (memory module) should use the affected workspace contracts/validation plus the root impact overlay.

## Common Commands

```bash
pnpm --filter pulse-coder-cli test
pnpm --filter pulse-coder-cli build
pnpm start
pnpm start:debug
```

Run commands from the repository root. `pnpm start` maps to the built CLI package, so run `pnpm --filter pulse-coder-cli build` first when `dist/` may be stale. `pnpm start:debug` rebuilds the CLI before launching the debugger.

## Key Files

- `src/index.ts`: entrypoint — arg parse and dispatch to print mode / Ink / readline.
- `src/readline/readline-host.ts`: readline fallback host — command loop, agent run wiring, and session save path.
- `src/ink/ink-controller.ts`: default Ink-mode controller with command handling, engine plan-mode wiring, agent/ACP routing, session sync, queued input, real token usage, and shutdown.
- `src/ink/ink-app.tsx`: Ink rendering (Static transcript + live region), input composer, paste handling, command suggestions, history, and mode shortcuts.
- `src/ink/ink-ui-bridge.ts`: append-only event + live-region bridge between runtime callbacks and the Ink UI; tool-result previews and streaming throttle live here.
- `src/ui-mode.ts`: `--ui`/`--tui`/`-p`/`--continue` and `PULSE_CODER_UI` resolution.
- `src/print/print-mode.ts`: `-p` one-shot runner; stdout carries only the answer, console logging is redirected to stderr.
- `src/terminal/markdown.ts`, `src/session/history-store.ts`: markdown-to-ANSI renderer and persisted prompt history.
- `src/shared/log-sink.ts`: console capture for the engine log layer (file + ring buffer + subscriber policy).
- `src/session/session.ts`, `src/commands/session-commands.ts`: session storage and slash-command behavior.
- `src/commands/acp-commands.ts`: `/acp` state commands, platform key resolution, session listing, and session close.
- `src/commands/team-commands.ts`: `/team`, `/teams`, and `/solo` command surface.
- `src/shared/memory-integration.ts`: memory plugin setup and per-run memory context.
- `src/shared/goal-integration.ts`: goal plugin singleton and per-session scope binding.
- `src/ink/controller-goal.ts`: host IO wiring for the goal runner (service resolution + verify command execution).
- `src/ink/controller-run.ts`: `runSingleTurn` (one agent round) and `startGoalLoop` (injects runOnce/confirm/verify into the plugin-kit runner).
- `src/tools/runtime-tools.ts`, `src/tools/canvas-runtime-tools.ts`: shared host-tool
  assembly and the structured Pulse Canvas capability adapter.
