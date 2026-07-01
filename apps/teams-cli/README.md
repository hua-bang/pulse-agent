# @pulse-coder/teams-cli

Terminal host for [`pulse-coder-agent-teams`](../../packages/agent-teams). It turns the team coordination runtime into a `pulse-teams` command with three modes: an automated `run` flow, a `plan`-only preview, and an `interactive` REPL.

This app is a thin host: argument parsing, terminal rendering, runtime wiring, and preview ergonomics. All team protocol behavior, task state, review gates, verification semantics, and public APIs live in `packages/agent-teams` — change protocol behavior there first.

> Package metadata and scripts: [`package.json`](./package.json). Local agent notes: [`AGENTS.md`](./AGENTS.md).

## Install

This is a pnpm workspace package (see `pnpm-workspace.yaml`), not a standalone install. From the repo root:

```bash
pnpm install
pnpm --filter @pulse-coder/teams-cli build
```

The build emits CommonJS to `dist/index.js` with a `#!/usr/bin/env node` shebang (see [`tsup.config.ts`](./tsup.config.ts)). The bin is `pulse-teams` → `./dist/index.js`.

## Usage

```bash
pulse-teams run "<task>"       # TeamLead-driven planning, execution, synthesis, follow-up
pulse-teams plan "<task>"      # Plan only via planTeam (preview, no execution)
pulse-teams interactive        # Interactive team management REPL
pulse-teams "<task>"           # Shorthand for 'run'
pulse-teams --help | -h        # Print usage
```

### `run`

Runs the full `TeamLead.orchestrate` flow (plan → spawn → create tasks → run → synthesize), prints the synthesis, then opens a follow-up loop. An empty follow-up input (or `exit`/`quit`) ends the run and cleans up the team.

```bash
pulse-teams run "Audit this codebase for security issues"
pulse-teams run "Build a REST API" --cwd /path/to/project --concurrency 2
```

Options (parsed in `src/index.ts`):

| Flag | Description |
|------|-------------|
| `--concurrency N` | Max teammates running in parallel. Must be a positive integer. Default `0` (unlimited). |
| `--cwd <dir>` | Working directory for teammates. Must exist and be a directory. Default: current directory. |
| `--verbose`, `-v` | Show LLM output from teammates (sets `InProcessDisplay` `showOutput`). Default: off. |

### `plan`

Calls `planTeam(taskDescription, { logger })` and prints the resulting `TeamPlan` (teammates and tasks). No teammates are spawned and no tasks execute.

```bash
pulse-teams plan "Refactor the auth module for testability"
```

### `interactive`

A local REPL (`teams>` prompt) for creating a team, spawning teammates, creating/running tasks, and messaging. Type `help` inside the REPL for the command list.

| Group | Commands |
|-------|----------|
| Team | `create [name]`, `spawn [name]`, `status`, `cleanup` |
| Tasks | `task <description>`, `tasks`, `run`, `plan <description>`, `orchestrate <description>` |
| Communication | `message <id> <text>`, `broadcast <text>`, `inbox` |
| Plan approval | `approve <teammate-id>`, `reject <id> <feedback>` |
| Other | `help`, `exit`, `quit` |

`exit`/`quit` cleans up any active team before closing. `create` and `spawn` default their names to `team-<timestamp>` / `teammate-<n>` when omitted.

## Environment

`run`, `plan`, and teammate execution are LLM-backed — they invoke the engine, so they require provider credentials and are not deterministic validation. Keys are env-only; never commit them.

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` / `PULSE_ANTHROPIC_API_KEY` | Anthropic provider credential |
| `OPENAI_API_KEY` / `PULSE_OPENAI_API_KEY` | OpenAI provider credential |

Default model precedence (resolved in `packages/engine/src/config/index.ts`): `ANTHROPIC_MODEL` → `OPENAI_MODEL` → `PULSE_ANTHROPIC_MODEL` → `PULSE_OPENAI_MODEL` → `novita/deepseek/deepseek_v3`. `PULSE_`-prefixed fallbacks exist for every provider variable.

## Scripts

```bash
pnpm --filter @pulse-coder/teams-cli build       # tsup (CJS, sourcemaps, shebang)
pnpm --filter @pulse-coder/teams-cli dev         # tsup --watch
pnpm --filter @pulse-coder/teams-cli start       # node dist/index.js
pnpm --filter @pulse-coder/teams-cli test        # vitest run --passWithNoTests
pnpm --filter @pulse-coder/teams-cli typecheck   # tsc --noEmit
```

Preview scripts build then run with source maps (`node --enable-source-maps`):

```bash
pnpm --filter @pulse-coder/teams-cli preview        # interactive
pnpm --filter @pulse-coder/teams-cli preview:run    # run (reads task from stdin/args)
pnpm --filter @pulse-coder/teams-cli preview:plan   # plan (reads task from stdin/args)
```

From the repo root, `pnpm preview:teams`, `pnpm preview:teams:run`, and `pnpm preview:teams:plan` build the upstream dependencies (`pulse-coder-orchestrator`, `pulse-coder-engine`, `pulse-coder-agent-teams`) first, then invoke the corresponding preview script here.

## Relationship to `packages/agent-teams`

| Concern | Owner |
|---------|-------|
| CLI modes, argument parsing, terminal display, follow-up loop, printed usage | this app (`src/index.ts`) |
| `Team`, `TeamLead`, `Teammate`, `TaskList`, `Mailbox`, `planTeam`, `TeamPlan` | `pulse-coder-agent-teams` |
| Team protocol, task lifecycle, review gates, verification semantics, runtime APIs | `pulse-coder-agent-teams` |
| Event rendering (progress bar, status ticker, final report) | `InProcessDisplay` from `pulse-coder-agent-teams` |

`src/index.ts` imports `Team`, `TeamLead`, `InProcessDisplay`, and `planTeam` from `pulse-coder-agent-teams`. Team creation in both `run` and `interactive` modes passes `defaultTeammateEngineOptions: { disableBuiltInPlugins: true }` — changing that affects local preview safety and should be intentional.

For the runtime contracts, classic API, task model, and teammate tools, see [`packages/agent-teams/README.md`](../../packages/agent-teams/README.md) and [`packages/agent-teams/docs/contracts.md`](../../packages/agent-teams/docs/contracts.md).

## Key files

- [`src/index.ts`](./src/index.ts) — CLI entrypoint: argument parsing, `run`/`plan`/`interactive` modes, follow-up loop, banner/phase/plan rendering, and printed usage.
- [`src/display/in-process.ts`](./src/display/in-process.ts) — a local `InProcessDisplay` class definition. Note: the entrypoint currently imports `InProcessDisplay` from `pulse-coder-agent-teams` rather than this local file.
- [`tsup.config.ts`](./tsup.config.ts) — CJS-only build, `es2022` target, sourcemaps, shebang banner, no DTS.
- [`tsconfig.json`](./tsconfig.json) — extends the root tsconfig; `rootDir: ./src`, excludes test files.

## Known gaps (honest)

- **No test coverage**: `test` runs `vitest run --passWithNoTests` with no test files in this app. It verifies the test harness only, not app behavior.
- **`typecheck` is non-default**: it currently fails with TS6059 because this app imports workspace source from `packages/agent-teams`, `packages/engine`, and `packages/orchestrator` outside this app's `rootDir` (`./src`). Prefer `build` as the JS smoke check until that TypeScript boundary is fixed.
- **CommonJS holdout**: this app is `"type": "commonjs"` in an otherwise ESM repo. Match the package's `"type"` when adding code.
- **No automated gates**: there is no CI, no git hooks, and no executable harness checks. Run `build` and `test` by hand.
- **LLM-backed previews**: `run`/`plan`/`orchestrate` invoke real LLM calls; do not treat them as cheap deterministic validation.
