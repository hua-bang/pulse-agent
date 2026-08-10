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
