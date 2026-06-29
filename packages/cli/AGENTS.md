# AGENTS.md - packages/cli

> Local entry for `packages/cli`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-cli` owns the interactive terminal application on top of `pulse-coder-engine`. It handles sessions, slash commands, Ink UI, input management, ACP commands, team commands, memory integration, and the CLI-only `run_js` sandbox adapter.

CLI behavior should remain a host layer over the engine. Engine runtime behavior belongs in `packages/engine`; team coordination behavior belongs in `packages/agent-teams`.

## Knowledge Navigation

| Task | Read |
|---|---|
| CLI entrypoint | `src/index.ts` |
| Ink UI app | `src/ink-app.tsx`, `src/ink-launcher.tsx` |
| Input handling | `src/input-manager.ts` |
| Sessions | `src/session.ts`, `src/session-commands.ts` |
| Skills slash commands | `src/skill-commands.ts` |
| Team commands | `src/team-commands.ts` |
| ACP commands | `src/acp-commands.ts` |
| Memory integration | `src/memory-integration.ts` |

## Local Constraints

- Keep CLI-specific state and UI behavior in this package; do not push UI concerns into the engine.
- Slash command changes should preserve session persistence and abort/clarification behavior.
- Prefer targeted tests for command parsing, session workflows, input handling, and UI mode behavior.
- Contract changes with engine, ACP, teams, or memory packages should follow `harness/skills/contract-coding.md`.

## Common Commands

```bash
pnpm --filter pulse-coder-cli test
pnpm --filter pulse-coder-cli build
pnpm start
pnpm start:debug
```

## Key Files

- `src/index.ts`: CLI entrypoint.
- `src/ink-app.tsx`: main Ink UI application.
- `src/input-manager.ts`: terminal input handling.
- `src/session-commands.ts`: session command behavior.
- `src/skill-commands.ts`: `/skills` command handling.
- `src/team-commands.ts`: agent teams command surface.
