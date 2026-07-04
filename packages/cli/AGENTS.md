# AGENTS.md - packages/cli

> Local entry for `packages/cli`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-cli` owns the interactive terminal host on top of `pulse-coder-engine`. It handles the default Ink UI, the readline fallback UI, session persistence, slash commands, clarification input, ACP mode, teams commands, memory integration, task-list binding, and registration of the `run_js` tool from `pulse-sandbox`.

CLI behavior should remain a host layer over the engine. Engine runtime behavior belongs in `packages/engine`; ACP protocol behavior belongs in `packages/acp`; team coordination behavior belongs in `packages/agent-teams`; sandbox execution behavior belongs in `packages/pulse-sandbox`.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview and scripts | `README.md`, `package.json` |
| UI mode selection | `src/ui-mode.ts` |
| Default Ink host path | `src/ink-launcher.tsx`, `src/ink-controller.ts`, `src/ink-app.tsx`, `src/ink-ui-bridge.ts` |
| Readline fallback host path | `src/index.ts`, `src/tui-renderer.ts` |
| Input handling | `src/input-manager.ts` |
| Sessions | `src/session.ts`, `src/session-commands.ts` |
| Skills and worktree slash commands | `src/skill-commands.ts`, `src/index.ts`, `src/ink-controller.ts` |
| Team commands and teams mode | `src/team-commands.ts`, `../agent-teams/AGENTS.md` |
| ACP commands and routing | `src/acp-commands.ts`, `../acp/AGENTS.md` |
| Memory integration | `src/memory-integration.ts` |
| `run_js` tool registration | `src/index.ts`, `src/ink-controller.ts`, `../pulse-sandbox/AGENTS.md` |
| Focused behavior tests | `src/*.test.ts` |

## Local Constraints

- Keep CLI-specific state and UI behavior in this package; do not push UI concerns into the engine.
- Keep command behavior aligned between the Ink controller and the readline fallback unless a change is intentionally UI-specific.
- Default startup selects Ink via `src/ui-mode.ts`; `PULSE_CODER_UI=readline` is the fallback path.
- Session files live under `~/.pulse-coder/sessions`; keep local runtime data out of source control and preserve session task-list metadata.
- Slash command changes should preserve session persistence, queued input, abort handling, clarification flow, and ACP passthrough behavior.
- This package currently has no `typecheck` script; do not document or rely on `pnpm --filter pulse-coder-cli typecheck` until `package.json` adds it.
- Current `run_js` registration imports `pulse-sandbox/src`; `src/sandbox-runner.ts` is not imported by the active CLI paths.
- Contract changes with engine, ACP, teams, sandbox, or memory packages should use the affected workspace contracts/validation plus the root impact overlay.

## Common Commands

```bash
pnpm --filter pulse-coder-cli test
pnpm --filter pulse-coder-cli build
pnpm start
pnpm start:debug
```

Run commands from the repository root. `pnpm start` maps to the built CLI package, so run `pnpm --filter pulse-coder-cli build` first when `dist/` may be stale. `pnpm start:debug` rebuilds the CLI before launching the debugger.

## Key Files

- `src/index.ts`: readline fallback CLI entrypoint, command loop, agent run wiring, ACP routing, and session save path.
- `src/ink-controller.ts`: default Ink-mode controller with command handling, agent/ACP routing, session sync, queued input, and shutdown.
- `src/ink-app.tsx`: Ink rendering, input composer, command suggestions, history, and mode shortcuts.
- `src/ink-ui-bridge.ts`: event/snapshot bridge between runtime callbacks and the Ink UI.
- `src/ui-mode.ts`: `--ui`/`--tui` and `PULSE_CODER_UI` resolution.
- `src/session.ts`, `src/session-commands.ts`: session storage and slash-command behavior.
- `src/acp-commands.ts`: `/acp` state commands, platform key resolution, session listing, and session close.
- `src/team-commands.ts`: `/team`, `/teams`, and `/solo` command surface.
- `src/memory-integration.ts`: memory plugin setup and per-run memory context.
