# CLI source layout

`src/index.ts` + `src/ui-mode.ts` at the root own entry dispatch (arg parse →
print / Ink / readline). Each host surface has a directory (`src/ink/`,
`src/readline/`, `src/print/`); host-shared modules are grouped by role
(`src/commands/`, `src/models/`, `src/session/`, `src/tools/`, `src/terminal/`,
and `src/shared/` for cross-host engine wiring). Tests sit beside the module
they cover.

## The ≤300-line rule and the host module clusters

Source files stay under ~300 lines. The four large host files are decomposed
into role modules, with the original file kept as the assembly/façade entry so
import paths stay stable:

- `src/ink/ink-controller.ts` — construction, initialize, mode switching,
  shutdown, and thin public delegators. Logic lives in `controller-defs.ts`
  (command tables), `controller-model.ts` (startup model, /model overrides,
  run options), `controller-pickers.ts` (/model + /resume modals),
  `controller-dispatch.ts` (slash routing, requestStop, submitInput),
  `controller-commands.ts` (handleCommand + /compact), `controller-run.ts`
  (runMessage pipeline, queue drain, usage), `controller-session.ts`
  (session/task-list plumbing, status publishing), `tool-payload.ts` (pure
  payload probes). Extracted functions take the controller as first argument;
  controller members are deliberately non-private for this.
- `src/ink/ink-app.tsx` — façade + component assembly; it re-exports
  `ink-types.ts`, `composer-edit.ts`, `composer-hints.ts` and `app-format.ts`,
  so `./ink-app.js` remains the import surface. The component wires
  `composer-actions.ts` (action factory), `app-input.ts` + `composer-keys.ts`
  (useInput callback factory), `use-composer-layout.ts` (every render-derived
  value; hook order preserved by unconditional call), `app-view.tsx` (the
  frame JSX) and `transcript-event.tsx`.
- `src/ink/ink-ui-bridge.ts` — snapshot + emit throttle shell extending
  `bridge-surface.ts` (thin message surface as an abstract base). State
  machinery lives in `live-run.ts` (live region + abort latch + finalize
  semantics) and `event-log.ts` (append-only events + ·×N trace merge);
  pure helpers in `event-text.ts`, `tool-input-format.ts`,
  `tool-output-format.ts`. `events`/`liveText`/`liveTools` stay readable on
  the bridge instance (tests and callers rely on the runtime shape).
- `src/readline/readline-host.ts` — assembly + input loop + Esc/SIGINT +
  session close. `command-surface.ts` (command tables + slash routing),
  `host-commands.ts` (handleCommand + /model), `host-context.ts`
  (ReadlineHost collaborators + shared host helpers), `agent-turn.ts` (one
  message → one engine run). `tui-renderer.ts` delegates to `tui-format.ts` /
  `tui-spinner.ts`.

Factory extractions (`buildComposerActions`, `buildKeyHandler`) destructure a
per-render context object so the extracted bodies stay verbatim — when editing
them, keep the context field list in sync with what the body references.

## Host tool boundaries

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

## Entry reference

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
