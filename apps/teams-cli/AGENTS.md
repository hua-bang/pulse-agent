# AGENTS.md - apps/teams-cli

> Local entry for `apps/teams-cli`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`@pulse-coder/teams-cli` is the CLI host for `pulse-coder-agent-teams`. It exposes team workflows for previewing, planning, and running multi-agent coordination from the terminal.

Team protocol behavior belongs in `packages/agent-teams`; this app should stay focused on CLI entrypoints, command modes, display, and host wiring.

## Knowledge Navigation

| Task | Read |
|---|---|
| CLI entrypoint | `src/index.ts` |
| In-process display | `src/display/in-process.ts` |
| Package scripts | `package.json` |
| Team runtime contracts | `../../packages/agent-teams/AGENTS.md` |
| Agent teams roadmap | `../../docs/07-agent-teams-maturity-roadmap.md` |

## Local Constraints

- Do not duplicate team runtime policy that belongs in `packages/agent-teams`.
- Keep command output and display behavior separate from team state transitions.
- Preview modes should remain safe for local experimentation.

## Common Commands

```bash
pnpm --filter @pulse-coder/teams-cli test
pnpm --filter @pulse-coder/teams-cli build
pnpm preview:teams
pnpm preview:teams:run
pnpm preview:teams:plan
```

`typecheck` currently hits TS6059 because the app imports workspace source from `packages/agent-teams`, `packages/engine`, and `packages/orchestrator` outside this app's `rootDir`; prefer `build` until that TypeScript boundary is fixed.

## Key Files

- `src/index.ts`: CLI entrypoint and command modes.
- `src/display/in-process.ts`: in-process display implementation.
- `package.json`: bin, scripts, and dependencies.
