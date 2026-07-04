# AGENTS.md - apps/teams-cli

> Local entry for `apps/teams-cli`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`@pulse-coder/teams-cli` is the terminal host for `pulse-coder-agent-teams`. It exposes three user-facing modes:

- `run`: TeamLead-driven planning, execution, synthesis, and follow-up loop.
- `plan`: plan-only preview through `planTeam`.
- `interactive`: local REPL for creating a team, spawning teammates, creating/running tasks, and messaging.

Team protocol behavior, task state, review gates, verification semantics, and public runtime APIs belong in `packages/agent-teams`. This app should stay focused on command parsing, terminal display, runtime host wiring, and preview ergonomics.

## Progressive Reading Path

| Task | Read |
|---|---|
| Repository and harness context | `../../AGENTS.md`, `../../harness/README.md`, `../../harness/validate/validation.yaml` |
| Package scripts and build shape | `package.json`, `tsup.config.ts`, `tsconfig.json` |
| CLI modes and arguments | `src/index.ts` |
| Terminal event rendering | `src/display/in-process.ts` |
| Team runtime entry and contracts | `../../packages/agent-teams/AGENTS.md`, `../../packages/agent-teams/docs/contracts.md` |
| Team runtime validation | `../../packages/agent-teams/harness/validate/validation.yaml`, `../../packages/agent-teams/docs/validation.md` |
| Maturity roadmap | `../../docs/07-agent-teams-maturity-roadmap.md` |

There are no local `README.md`, `docs/`, or `*.test.ts`/`*.spec.ts` files in this app at the time of writing.

## Local Constraints

- Do not duplicate or weaken protocol policy from `packages/agent-teams`; change protocol behavior in the runtime package first.
- Keep terminal rendering separate from team state transitions. `src/display/in-process.ts` should render `TeamEvent`s, not decide lifecycle semantics.
- Keep `run`, `plan`, and `interactive` mode behavior explicit in `src/index.ts`.
- Preserve cleanup paths: displays should stop and teams should clean up on failures or REPL exit.
- Current team creation passes `defaultTeammateEngineOptions: { disableBuiltInPlugins: true }`; changing that affects local preview safety and should be intentional.
- Preview/manual runs may invoke LLM-backed planning or teammate execution; do not treat them as cheap deterministic validation.

## Common Commands

Run from the repository root unless noted.

```bash
pnpm --filter @pulse-coder/teams-cli test
pnpm --filter @pulse-coder/teams-cli build
```

Manual preview commands, when provider credentials and a real task are available:

```bash
pnpm preview:teams
pnpm --filter @pulse-coder/teams-cli preview:plan -- "Plan a small repo maintenance task"
pnpm --filter @pulse-coder/teams-cli preview:run -- "Run a small repo maintenance task"
```

`test` currently uses `vitest run --passWithNoTests`, so it verifies the test harness but not app behavior. `typecheck` is a known non-default check: it currently hits TS6059 because the app imports workspace source from `packages/agent-teams`, `packages/engine`, and `packages/orchestrator` outside this app's `rootDir`. Prefer `build` until that TypeScript boundary is fixed.

## Validation Notes

- Harness-required checks for app changes: `pnpm --filter @pulse-coder/teams-cli test` and `pnpm --filter @pulse-coder/teams-cli build`.
- If a change alters team protocol, exported APIs, task lifecycle, or review/verification semantics, also run the relevant `packages/agent-teams` checks and apply root consumer escalation when needed.
- For terminal UX changes, include a short manual preview note when a preview was run, or state why it was skipped.

## Key Files

- `src/index.ts`: CLI entrypoint, argument parsing, run/plan/interactive modes, follow-up loop, and printed usage.
- `src/display/in-process.ts`: terminal renderer for team events, progress, status ticker, stderr filtering, and final report.
- `package.json`: bin path, scripts, runtime dependency on `pulse-coder-agent-teams`, and Vitest/tsup wiring.
- `tsconfig.json`: current `rootDir: ./src` boundary that explains the known `typecheck` failure.
