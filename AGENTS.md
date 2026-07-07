# AGENTS.md

This file orients agents working in the Coder repository. It is a thin routing + boundary layer; substantive knowledge lives downstream in `harness/`, per-workspace `AGENTS.md`, workspace-local `harness/`, and `docs/`.

## 0. Meta rules (precedence + SSOT)

1. **Precedence**: this file > affected workspace's `AGENTS.md` > affected workspace's `harness/*` + docs > `harness/validate/validation.yaml` (root impact overlay). Lower layers refine, never contradict, the upper.
2. **SSOT, no copies**: the active workspace set lives in `pnpm-workspace.yaml`; package metadata lives in each `package.json`; workspace role/navigation/knowledge lives in each workspace's `AGENTS.md`, local `harness/`, and docs. Runtime task skills under `.pulse-coder/skills/` are product/runtime config, not repo harness protocols.
3. **Mechanism over doc, stated honestly**: prefer extending plugin/hook/tool boundaries over hardcoding into `packages/engine/src/core/loop.ts`. There is currently NO automated gate layer (see §4); validation commands must be run by hand. Where a spec says "enforce," verify a runner exists before relying on it.
4. **First principles before solutions**: confirm the real problem, goal, constraints, and evidence (from current repo or reproducible behavior) before acting. Do not reverse-engineer a conclusion from an existing MR, neighboring code, or a candidate solution. If you cannot state what real problem a change solves and where the evidence is, do not implement.
5. **Occam / reuse-first**: reuse existing entries, modules, scripts, skills, and docs before adding new ones. Add a new skill, doc, abstraction, or process only when the current system cannot carry the work AND the new asset reduces real complexity or provides an executable constraint. "Could be updated to latest" is not a reason to add.

**Pre-implementation self-check** (run mentally before coding):
1. Is the problem real, with evidence from this repo or a reproducible case?
2. Can an existing entry / module / skill / script carry this — if not, why?
3. What is the minimal change that avoids parallel entries and duplicate rules?
4. Where is the SSOT for any rule I'm touching, and how do引用方 stay in sync?
5. Can this be a mechanism (type / lint / test / hook / script) rather than a doc line? If only doc, is the reason stated?

## 1. Routing

**Reading chain**: `AGENTS.md` → `harness/README.md` → affected workspace `AGENTS.md` → affected workspace `harness/` or docs as needed → `harness/validate/validation.yaml` for root/cross-workspace impact.

**Doc taxonomy:**
- **L0 root entries**: `AGENTS.md` (this file), `CLAUDE.md`, `README.md` — routing, harness pilot, project intro.
- **L1 mid-level index**: `harness/README.md`, `harness/validate/validation.yaml` (root validation overlay), root `docs/` topic dirs (`harness/`, `mcp-plugin/`, `memory-plugin/`, `plan-mode/`, `plugin-system/`).
- **L2 module entries**: each workspace's `AGENTS.md` (14 active) plus optional workspace-local `harness/knowledge/`, `harness/validate/`, `harness/tools/`, and `harness/skills/`.

**Intent navigation** (find the entry point; then read the workspace's own `AGENTS.md`):

| Intent | First file / dir |
|---|---|
| Add a built-in plugin | `packages/engine/src/built-in/index.ts` + new subdir |
| Register a tool | `packages/engine/src/tools/` (built-in) or `ctx.registerTool` in a plugin |
| Change the core loop / hooks | `packages/engine/src/core/loop.ts` |
| Add/fix an MCP server config | `.pulse-coder/mcp.json` + `packages/engine/src/built-in/mcp-plugin/` |
| Tune context compaction | `packages/engine/src/core/loop.ts` + env (`CONTEXT_WINDOW_TOKENS`, `COMPACT_*`, `KEEP_LAST_TURNS`) |
| Add a runtime skill | `.pulse-coder/skills/<name>/SKILL.md` |
| Add a sub-agent | `.pulse-coder/agents/*.md` |
| Change an orchestration role | `packages/orchestrator/` |
| Change a remote-server adapter | `apps/remote-server/src/adapters/` + `core/dispatcher.ts` |
| Add a canvas node plugin | `packages/canvas-nodes/` |
| Add/remove a workspace | `pnpm-workspace.yaml` + workspace `AGENTS.md` + workspace `harness/validate/validation.yaml` + root overlay if cross-workspace impact changes |
| Update what to run for a workspace path | affected workspace `harness/validate/validation.yaml` |
| Review changes (repo-aware) | affected workspace `AGENTS.md` + `node scripts/harness/run-harness-check.mjs` |
| Inspect harness coverage | `node scripts/harness/check-harness.mjs` |
| Run bound checks for a change | `node scripts/harness/run-harness-check.mjs` |

## 2. Hard boundaries (real values)

- **Package manager**: `pnpm@10.28.0` (`packageManager`). Never npm/yarn.
- **Node**: unpinned (no `.nvmrc`/`engines`). Do not assume a version; adding a pin is an open gap.
- **TypeScript**: `strict:true` from root `tsconfig.json`. Keep strict ON. `apps/teams-cli` + `apps/canvas-workspace` use standalone tsconfigs — root changes do not reach them. `plugin-kit`/`memory-plugin`/`langfuse-plugin`/`teams-cli` typecheck hits TS6059 rootDir errors locally — default to `build` as the JS smoke check there. (`engine` had the same class from its agent-teams plugin importing orchestrator source; fixed by dropping `rootDir` from its tsconfig — `rootDir` is emit-layout config that `tsc --noEmit` and tsup do not need. Same fix likely applies to the four.)
- **Module format**: ESM repo-wide (`"type":"module"`). CommonJS holdouts: `packages/cli`, `packages/canvas-cli`, `apps/teams-cli` — match each package's `"type"`.
- **Tests**: `vitest run` (sole runner, no config file — defaults apply). Honest test reality: `plugin-kit`/`langfuse-plugin`/`orchestrator`/`teams-cli` use `--passWithNoTests` with ZERO real specs → green ≠ coverage. `remote-server` has NO typecheck (runtime app; its Vitest helper suites run via `test`, with `pretest` building plugin-kit). `cli` has NO typecheck.
- **Build**: `tsup`; root `build` uses `SKIP_DTS=1`.
- **Path aliases**: only `pulse-coder-engine`, `pulse-coder-orchestrator`, `pulse-coder-plugin-kit`, `pulse-coder-acp`, `pulse-coder-agent-teams` (root `tsconfig.json`). Use `workspace:*` deps for the rest; do not invent aliases.
- **Lint/format**: ABSENT (no eslint/prettier/biome). Self-enforce; match surrounding files (2 spaces, semicolons, single quotes).

## 3. Auxiliary-workspace boundary

Active pnpm workspaces = `packages/*` + `apps/remote-server` + `apps/teams-cli` + `apps/canvas-workspace`. `apps/coder-demo`, `apps/devtools-web`, `apps/canvas-plugin-react-mf-note-demo` are real but excluded (no AGENTS.md — excluded by policy). `apps/EXPERIMENTAL.md` is stale (claims `canvas-workspace` excluded) — trust `pnpm-workspace.yaml`, not that file.

## 4. Prerequisite gates (honest: none are mechanical)

The only CI is `.github/workflows/perf.yml` — canvas-workspace bundle-size ratchets + runtime counter gates on PRs touching that app. Beyond it there is NO CI for tests/typecheck, NO git hooks, and NO husky/lint-staged/commitlint. Workspace-local `harness/validate/validation.yaml` files and root `harness/validate/validation.yaml` are executed by the manual runner `node scripts/harness/run-harness-check.mjs` — nothing triggers it for you; run it yourself. Wired harness executables live in `scripts/harness/` (`run-harness-check.mjs`, `check-harness.mjs`). Other tool ideas are not on-disk tools until implemented.

**Runtime skills are product config, not repo harness protocols:**

| Tier | Location | Role | Loaded how |
|---|---|---|---|
| Runtime task skills | `.pulse-coder/skills/*/SKILL.md` | On-demand task knowledge/procedures for the product runtime | engine skills plugin → `skill` tool |
| Repo action protocols | Not currently materialized | Future stable workflow docs only when the workflow justifies a file | Manual, if added later |

**Action → required pre-read** (manual, no runtime enforcement):

| Action | Read first |
|---|---|
| Touch a workspace's code | that workspace's `AGENTS.md` + local `harness/validate/validation.yaml` |
| Change crossing package contracts | affected workspace contracts/knowledge + root `harness/validate/validation.yaml` escalation rules |
| Add/adjust repo or workspace docs | nearest owning `AGENTS.md`, `harness/DESIGN.md`, or local harness/doc owner |
| Propose a process / governance change | `harness/DESIGN.md`, `harness/README.md`, and `harness/ROADMAP.md` |
| Review a diff (repo-aware) | affected workspace `AGENTS.md`, local validation, and root impact overlay when relevant |
| Quality self-check / acceptance gate | local validation first, then root overlay for root/cross-workspace impact |

Do not route required work to nonexistent `harness/skills/*` files. Add a repo action protocol only when the workflow is stable enough and the file removes real ambiguity.

**Gap to close (aspirational, not present):** the manual runner exists; still missing are candidate mechanical checks (add only when their rules are stable enough to mechanize) and any automatic trigger (opt-in pre-push, CI) — defer those until the runner's false-positive rate is proven near zero. Do not claim these exist today.

## 5. Acceptance (reproducible + verifiable)

Run the commands the affected workspace's `harness/validate/validation.yaml` binds to your changed path — `node scripts/harness/run-harness-check.mjs` (default: current git status; `--since <ref>`, `--path <p...>`, `--all`, `--dry-run`) resolves and runs them for you:
- Package change → start with the affected workspace's local validation commands.
- Root config change → use root `harness/validate/validation.yaml`.
- Cross-package / contract change → also apply relevant escalation rules in root `harness/validate/validation.yaml`.
- Full local sweep → `pnpm run build` (SKIP_DTS=1), then `pnpm run test:core`.
- `canvas-workspace` is in `test:all`/`build:all` but NOT `build:core`/`test:core` — include it explicitly when you touch it.
- Harness data change → `node scripts/harness/check-harness.mjs` must report `harnessGaps: 0` (the runner triggers it automatically for harness paths).

**Red command — do not promote:** `pnpm run test:apps` can exit 1 because `apps/coder-demo`'s test script is `echo Error && exit 1`. Use targeted `pnpm --filter <pkg> test`; do not treat a bare `test:apps` failure as a regression unless you've filtered out excluded apps. Likewise a green `pnpm test` is not proof for `plugin-kit`/`langfuse-plugin`/`orchestrator`/`teams-cli` (no real specs).

## 6. Failure capture (named failure → guard)

- **Over-pruning tool-call history dropped later user turns**: first fix sliced messages at the first incomplete tool-call, losing legitimate later user turns. Guard: `pruneIncompleteToolExchanges()` surgically filters only the incomplete part; regression tests in `packages/engine/src/core/loop.test.ts` assert later user turns survive. Any new message-history cleanup in `loop.ts` MUST add a parallel regression test.
- **Blocking I/O froze the Electron host**: `bash` tool used `execSync`, blocking the event loop and freezing `canvas-workspace` UI. Guard: `bash.ts` now uses async `spawn` with `SIGTERM`→`SIGKILL`. Rule: never `execSync`/blocking I/O in `packages/engine/src/tools/*` — the engine runs on GUI main threads. (Two wrong-root-cause fixes — pulse-sandbox interrupt, PTY coalescing — were reverted; confirm the actual blocking call before patching adjacent paths.)
- **UTF-8 chunk-split corruption**: async rewrite decoded each pipe chunk independently, corrupting multi-byte CJK. Guard: collect raw `Buffer`s and decode once.
- **grep shell injection + blocking I/O**: `grep.ts` built a shell string and ran it with `execSync` (`shell:/bin/bash`); arguments were quoted only when they contained space/`$`/`*`, so an agent-generated pattern like `x;touch /tmp/pwned` reached the shell unescaped, and the `execSync` also violated the no-blocking-I/O rule. Guard: pass args as an array to async `execFile` (no shell), do offset/limit in-process; regression test in `packages/engine/src/tools/grep.test.ts` asserts the injecting pattern does not execute.
- **MCP reload stale/empty state**: reload didn't activate the target scope first. Guard: `activateScope` before reload, force fresh probe.
- **Stale doc claimed canvas-workspace excluded**: `apps/EXPERIMENTAL.md` contradicts `pnpm-workspace.yaml:5`. Guard: `pnpm-workspace.yaml` owns workspace membership; run `check-harness.mjs` to detect coverage drift; do not trust prose workspace lists.
- **Declared-but-unwired tests masked a real bug**: `remote-server` carried 6 Vitest files with no `test` script and no vitest dep; once wired, they exposed a ProxyAgent cache-key bug (cache stored the normalized URL but compared the raw env value — never hit, new agent per download). Guard: suite bound in the app's `harness/validate/validation.yaml` (`pretest` builds plugin-kit); when bootstrapping any workspace, cross-check test files × test script before trusting "no tests here".

Failures are captured in fix commits + regression tests — debug via `git log -- <file>` and focused tests, not by grepping for TODOs.

**Task-end write-back**: before finishing a task, route what it taught you — new fact → the nearest owning doc or workspace `AGENTS.md`; new check → the affected workspace's `harness/validate/validation.yaml`; a cross-module rule that cannot become a check → one line appended to this section. No separate feedback store.

## 7. Security / secrets

Do not commit API keys or tokens. Runtime keys (`OPENAI_API_KEY`/`PULSE_OPENAI_API_KEY`, `ANTHROPIC_API_KEY`/`PULSE_ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `GEMINI_API_KEY`, `INTERNAL_API_SECRET`, `CLARIFICATION_*`) are env-only. Default model precedence (code at `packages/engine/src/config/index.ts`): `ANTHROPIC_MODEL` → `OPENAI_MODEL` → `PULSE_ANTHROPIC_MODEL` → `PULSE_OPENAI_MODEL` → `novita/deepseek/deepseek_v3`. `PULSE_`-prefixed fallbacks exist for every provider var. Remote-server internal routes are loopback-only and require `INTERNAL_API_SECRET`. Plugin secret storage uses the vault helpers in `pulse-coder-plugin-kit`.

## 8. `.pulse-coder/` vs `.coder/`

`.pulse-coder/` is the active runtime/product config root. On disk it holds `mcp.json` (3 servers: `eido_mind`, `deepwiki`, `twitter` — all `deferTools:true`), `agents/` (8 sub-agents), `skills/` (10 runtime knowledge skills). `config.json`, `engine-plugins/`, and `skills/remote.json` are ABSENT on disk but their loaders are wired in source. Legacy `.coder/*` paths remain compatible in the MCP/skills/sub-agent/engine-plugins loaders but are not preferred — write new config under `.pulse-coder/`. Runtime skills (`.pulse-coder/skills`) are not repo harness protocols.
