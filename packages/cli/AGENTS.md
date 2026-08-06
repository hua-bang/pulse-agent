# AGENTS.md - packages/cli

> Local entry for `packages/cli`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-cli` owns the interactive terminal host on top of `pulse-coder-engine`. It handles the default Ink UI, the readline fallback UI, the `-p/--print` non-interactive mode, session persistence, slash commands (including `/<skill-name>` invocation), clarification input, model switching, memory integration, task-list binding, and host tool registration (`run_js` plus the experimental Pulse Canvas capability adapter).

CLI behavior should remain a host layer over the engine. Engine runtime behavior belongs in `packages/engine`; ACP protocol behavior belongs in `packages/acp`; team coordination behavior belongs in `packages/agent-teams`; sandbox execution behavior lives locally in `src/sandbox/` (executor + forked `runner` — built as `dist/runner.cjs`).

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview and scripts | `README.md`, `package.json` |
| UI mode / CLI flag parsing | `src/ui-mode.ts` |
| Default Ink host path | `src/ink-launcher.tsx`, `src/ink-controller.ts`, `src/ink-app.tsx`, `src/ink-ui-bridge.ts` |
| Readline fallback host path | `src/index.ts`, `src/tui-renderer.ts` |
| Non-interactive `-p` mode | `src/print-mode.ts` |
| Markdown-to-ANSI rendering | `src/markdown.ts` |
| Prompt history persistence | `src/history-store.ts` |
| Engine log layer (`/debug`) | `src/log-sink.ts` |
| Model registry (`/model`, `--model`) | `src/model-registry.ts` |
| Input handling | `src/input-manager.ts` |
| Sessions | `src/session.ts`, `src/session-commands.ts` |
| Skills and worktree slash commands | `src/skill-commands.ts`, `src/index.ts`, `src/ink-controller.ts` |
| Retired team/ACP modules (unwired) | `src/team-commands.ts`, `src/acp-commands.ts` |
| Memory integration | `src/memory-integration.ts` |
| Host tool registration | `src/runtime-tools.ts`, `src/canvas-runtime-tools.ts`, `src/sandbox/`, `../canvas-cli/AGENTS.md` |
| Focused behavior tests | `src/*.test.ts` |

## Local Constraints

- Keep CLI-specific state and UI behavior in this package; do not push UI concerns into the engine.
- Keep command behavior aligned between the Ink controller and the readline fallback unless a change is intentionally UI-specific.
- Default startup selects Ink via `src/ui-mode.ts`; `PULSE_CODER_UI=readline` is the fallback path.
- Ink transcript model: `InkUiBridge.events` is append-only and rendered via Ink `<Static>` (printed once into terminal scrollback). Never mutate an already-emitted event — stream into `liveText`/`liveTools` and finalize on boundaries (tool call, tool result, run end, abort).
- The Ink host renders with `exitOnCtrlC: false`; Ctrl+C double-press exit lives in `ink-app.tsx`. Re-enabling Ink's built-in handler would exit on the first press and skip session save.
- CLI interaction modes are exactly the two engine states: `edit` → `setMode('executing')`, `plan` → `setMode('planning')` (see `applyInteractionMode`). `/chat`, `/auto`, `/execute` remain accepted as aliases for edit — do not reintroduce modes without a real behavioral difference backing them.
- Slash command resolution is strictly ordered: built-in > runtime skill > error. Built-ins always win, so a skill cannot shadow a real command; colliding skills are dropped from the palette and stay reachable via `/skills <name> <message>`. Skills reach the composer through the snapshot's `skills` field, published once after engine init.
- `/team`, `/teams`, `/solo`, `/acp` and the `//` passthrough are retired from BOTH hosts (see `RETIRED_COMMANDS` in each). Their modules and the `pulse-coder-acp` dependency are intentionally kept so the capability can return; do not re-add them to `LOCAL_COMMANDS` without also restoring abort support and routing their output through the bridge.
- Bare `/resume` opens a modal picker (snapshot `picker` field, same pattern as clarification) — Ink host only; the readline host keeps the text form, an intentional UI-specific divergence. Session list previews must go through `extractMessageText` (`session.ts`) — context messages carry AI SDK structured content, and `String(content)` renders `[object Object]`. The picker is shared by `/model` via `activePicker` routing in the controller.
- Per-model `contextWindow` (models.json) must flow through `modelRunOptions()` into BOTH the run options and `compactContext` — the status-line ctx% denominator and the engine's compaction trigger/target must never diverge.
- models.json is provider-granular and committable: provider entries carry `baseUrl` + `apiKeyEnv` (an env var NAME); inline `apiKey` values are ignored with a warning — never let secrets into this file (root AGENTS §7). Provider-bound choices build their connection via the engine's `buildProvider(type, {baseURL, apiKey})` inside `modelRunOptions()`.
- The registry loads from BOTH `~/.pulse-coder/models.json` and `<cwd>/.pulse-coder/models.json` and merges them (project wins per provider name and per `provider:model` id; home models referencing a redefined provider are rebased onto the project connection). A home-only setup must keep working from any directory — do not reduce this back to a single-scope lookup.
- Startup failures must write to `process.stderr` directly (see `main().catch`): with `EngineLogSink` installed, `console.error` is captured into the log file and a crash before render is otherwise silent. This package has no typecheck script — a missing cross-package export (e.g. an engine re-export) surfaces only at runtime, so smoke-launch after wiring new engine imports.
- Multi-character `useInput` chunks are pastes (or coalesced typing) and must be inserted literally — never interpreted as Enter/Tab; bracketed paste additionally arrives via Ink's `usePaste` channel.
- The Ink host renders with `patchConsole: false`: `EngineLogSink` owns `console.*` (installed before engine init) and routes it to `~/.pulse-coder/logs/cli.log` + the `/debug` policy (errors surface as dim lines; warns dedupe per unique text per session; info/debug only with `/debug on`, `--verbose`, or `--verbose`). Never write to stdout directly from Ink-host code paths — it tears the frame; log via `console.*` (captured) or the bridge.
- Tool traces are gray one-line summaries by default (`label · N lines/matches`, single-line output inlined, structured output yields NO summary — never a JSON dump); failures stay red with the error inline. `Ctrl+O` toggles content previews and, per the Static model, affects only future traces.
- Assistant text is two-tier: segments finalized because a tool call started are narration (`status: 'info'`, rendered gray, no markdown); only the segment that ends a run renders bright with markdown. The status line's TEXT stays stable during a run (`Running agent · <elapsed>`) — never write per-tool churn into `status`.
- Everything rendered BELOW `<Static>` shares one screen with the composer, so every such region must be bounded by terminal size: transcript-adjacent lists window on rows (`liveTools`, picker, prompt lines) and single lines bound on columns (`formatStatusline` sheds tail segments, `truncateLabel` clips live tool labels). An unbounded `.map()` there pushes the composer off screen — check this when adding any live region. Print-style commands (`/sessions`, `section()`) go into scrollback instead, but still take an explicit count bound so a long history cannot flood the transcript.
- Session files live under `~/.pulse-coder/sessions`; keep local runtime data out of source control and preserve session task-list metadata.
- Slash command changes should preserve session persistence, queued input, abort handling, and the clarification flow.
- This package currently has no `typecheck` script; do not document or rely on `pnpm --filter pulse-coder-cli typecheck` until `package.json` adds it.
- `src/runtime-tools.ts` is the shared tool assembly for both UI hosts. Keep Ink
  and readline on this entry so `run_js` and live-app capabilities cannot drift.
- Live-app capability tools are absent by default; expose them only when
  `PULSE_CODER_EXPERIMENTAL_APP_RUNTIME=1`. The Canvas host separately requires
  its `agent-runtime-control` flag, so both sides opt into the hidden feature.
- When live-app capability tools are registered, their descriptions and the
  bundled Pulse Canvas skill must route the agent to native tools first;
  `pulse-canvas runtime` is the fallback for hosts without those tools. Both
  entries share `@pulse-coder/canvas-cli/core`; do not fork transport policy.
- `run_js` registration imports `src/sandbox/index.js`; `src/sandbox/runner.ts` is never imported — it is the fork target `resolveRunnerPath()` locates next to the built bundle (`dist/runner.cjs`), so keep the tsup `runner` entry in sync.
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

- `src/index.ts`: shared entrypoint (arg parse → print mode / Ink / readline), readline command loop, agent run wiring, ACP routing, and session save path.
- `src/ink-controller.ts`: default Ink-mode controller with command handling, engine plan-mode wiring, agent/ACP routing, session sync, queued input, real token usage, and shutdown.
- `src/ink-app.tsx`: Ink rendering (Static transcript + live region), input composer, paste handling, command suggestions, history, and mode shortcuts.
- `src/ink-ui-bridge.ts`: append-only event + live-region bridge between runtime callbacks and the Ink UI; tool-result previews and streaming throttle live here.
- `src/ui-mode.ts`: `--ui`/`--tui`/`-p`/`--continue` and `PULSE_CODER_UI` resolution.
- `src/print-mode.ts`: `-p` one-shot runner; stdout carries only the answer, console logging is redirected to stderr.
- `src/markdown.ts`, `src/history-store.ts`: markdown-to-ANSI renderer and persisted prompt history.
- `src/log-sink.ts`: console capture for the engine log layer (file + ring buffer + subscriber policy).
- `src/session.ts`, `src/session-commands.ts`: session storage and slash-command behavior.
- `src/acp-commands.ts`: `/acp` state commands, platform key resolution, session listing, and session close.
- `src/team-commands.ts`: `/team`, `/teams`, and `/solo` command surface.
- `src/memory-integration.ts`: memory plugin setup and per-run memory context.
- `src/runtime-tools.ts`, `src/canvas-runtime-tools.ts`: shared host-tool
  assembly and the structured Pulse Canvas capability adapter.
