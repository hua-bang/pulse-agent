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
4. Where is the SSOT for any rule I'm touching, and how do referencing parties stay in sync?
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
| Add a Canvas capability for Tool + CLI | `harness/skills/add-canvas-capability/SKILL.md` |
| Change the core loop / hooks | `packages/engine/src/core/loop.ts` |
| Add/fix an MCP server config | `.pulse-coder/mcp.json` + `packages/engine/src/built-in/mcp-plugin/` |
| Tune context compaction | `packages/engine/src/core/loop.ts` + env (`CONTEXT_WINDOW_TOKENS`, `COMPACT_*`, `KEEP_LAST_TURNS`) |
| Offload oversized tool results to disk | `packages/engine/src/built-in/tool-offload-plugin/` + env (`TOOL_OFFLOAD_THRESHOLD`, `TOOL_OFFLOAD_DIR`) |
| Add a runtime skill | `.pulse-coder/skills/<name>/SKILL.md` |
| Add a sub-agent | `.pulse-coder/agents/*.md` |
| Change an orchestration role | `packages/engine/src/orchestrator/` (subpath export `pulse-coder-engine/orchestrator`) |
| Change a remote-server adapter | `apps/remote-server/src/adapters/` + `core/dispatcher.ts` |
| Add/change a keyboard shortcut | `apps/canvas-workspace/src/renderer/src/shortcuts/definitions.ts` (SSOT) + the owning handler table; check `apps/canvas-workspace/src/main/app/menu.ts` for an accelerator that would eat the key first |
| Add/remove a workspace | `pnpm-workspace.yaml` + workspace `AGENTS.md` + workspace `harness/validate/validation.yaml` + root overlay if cross-workspace impact changes |
| Update what to run for a workspace path | affected workspace `harness/validate/validation.yaml` |
| Review changes (repo-aware) | affected workspace `AGENTS.md` + `node scripts/harness/run-harness-check.mjs` |
| Inspect harness coverage | `node scripts/harness/check-harness.mjs` |
| Run bound checks for a change | `node scripts/harness/run-harness-check.mjs` |
| Visualize root/package/app harness | `harness/skills/visualize-harness/SKILL.md` |
| Slim an overweight AGENTS.md / extract inline knowledge | `harness/skills/slim-agents-md/SKILL.md` |

## 2. Hard boundaries (real values)

- **Package manager**: `pnpm@10.28.0` (`packageManager`). Never npm/yarn.
- **Node**: unpinned (no `.nvmrc`/`engines`). Do not assume a version; adding a pin is an open gap.
- **TypeScript**: `strict:true` from root `tsconfig.json`. Keep strict ON. `apps/canvas-workspace` uses a standalone tsconfig — root changes do not reach it. `plugin-kit`/`memory-plugin`/`langfuse-plugin` typecheck hits TS6059 rootDir errors locally — default to `build` as the JS smoke check there. (`engine` had the same class from cross-package source imports via a root alias; fixed by dropping `rootDir` from its tsconfig — `rootDir` is emit-layout config that `tsc --noEmit` and tsup do not need. Same fix likely applies to the rest.)
- **Module format**: ESM repo-wide (`"type":"module"`). CommonJS holdouts: `packages/cli`, `packages/canvas-cli` — match each package's `"type"`.
- **Tests**: `vitest run` (sole runner, no config file — defaults apply). Honest test reality: `plugin-kit`/`langfuse-plugin` use `--passWithNoTests` with ZERO real specs, and engine's `src/orchestrator/` module has no specs of its own → green ≠ coverage there. `remote-server` has NO typecheck (runtime app; its Vitest helper suites run via `test`, with `pretest` building plugin-kit). `cli` has NO typecheck.
- **Build**: `tsup`; root `build` uses `SKIP_DTS=1`.
- **Path aliases**: only `pulse-coder-engine`, `pulse-coder-plugin-kit`, `pulse-coder-acp`, `pulse-coder-agent-teams` (root `tsconfig.json`). Use `workspace:*` deps for the rest; do not invent aliases.
- **Lint/format**: ABSENT (no eslint/prettier/biome). Self-enforce; match surrounding files (2 spaces, semicolons, single quotes).

## 3. Auxiliary-workspace boundary

Active pnpm workspaces = `packages/*` + `apps/remote-server` + `apps/canvas-workspace`. `apps/devtools-web` is real but excluded from the workspace set (no AGENTS.md — excluded by policy). Do NOT delete it: `apps/remote-server/src/server.ts` serves `../devtools-web/dist` at runtime as its devtools UI (`DEVTOOLS_DIST_PATH` overrides).

## 4. Prerequisite gates (honest: none are mechanical)

The only CI is `.github/workflows/perf.yml` — canvas-workspace bundle-size ratchets on PRs touching that app, with full runtime counters only for performance-sensitive paths, a `performance` PR label, manual dispatch, or default-branch pushes; macOS package gates use the same selective policy. Beyond it there is NO CI for tests/typecheck, NO git hooks, and NO husky/lint-staged/commitlint. Workspace-local `harness/validate/validation.yaml` files and root `harness/validate/validation.yaml` are executed by the manual runner `node scripts/harness/run-harness-check.mjs` — nothing triggers it for you; run it yourself. Wired harness executables live in `scripts/harness/` (`run-harness-check.mjs`, `check-harness.mjs`). Other tool ideas are not on-disk tools until implemented.

**Runtime skills are product config, not repo harness protocols:**

| Tier | Location | Role | Loaded how |
|---|---|---|---|
| Runtime task skills | `.pulse-coder/skills/*/SKILL.md` | On-demand task knowledge/procedures for the product runtime | engine skills plugin → `skill` tool |
| Repo action protocols | `harness/skills/*/SKILL.md` when present | Stable workflows for agents maintaining this repository | Manual from the owning `AGENTS.md` route |

**Action → required pre-read** (manual, no runtime enforcement):

| Action | Read first |
|---|---|
| Touch a workspace's code | that workspace's `AGENTS.md` + local `harness/validate/validation.yaml` |
| Change crossing package contracts | affected workspace contracts/knowledge + root `harness/validate/validation.yaml` escalation rules |
| Add/adjust repo or workspace docs | nearest owning `AGENTS.md`, `harness/DESIGN.md`, or local harness/doc owner |
| Propose a process / governance change | `harness/DESIGN.md`, `harness/README.md`, and `harness/ROADMAP.md` |
| Review a diff (repo-aware) | affected workspace `AGENTS.md`, local validation, and root impact overlay when relevant |
| Quality self-check / acceptance gate | local validation first, then root overlay for root/cross-workspace impact |

Route only to repo action protocols that exist on disk. Add one only when the workflow is stable enough and the file removes real ambiguity.

**Gap to close:** the manual runner and structural drift checks exist; still missing are semantic checks for contradictions/test effectiveness and any automatic trigger (opt-in pre-push, CI). Defer automatic enforcement until the runner's false-positive rate is proven near zero.

## 5. Acceptance (reproducible + verifiable)

Run the commands the affected workspace's `harness/validate/validation.yaml` binds to your changed path — `node scripts/harness/run-harness-check.mjs` (default: current git status; `--since <ref>`, `--path <p...>`, `--all`, `--dry-run`) resolves and runs them for you:
- Package change → start with the affected workspace's local validation commands.
- Root config change → use root `harness/validate/validation.yaml`.
- Cross-package / contract change → also apply relevant escalation rules in root `harness/validate/validation.yaml`.
- Full local sweep → `pnpm run build` (SKIP_DTS=1), then `pnpm run test:core`.
- `canvas-workspace` is in `test:all`/`build:all` but NOT `build:core`/`test:core` — include it explicitly when you touch it.
- Harness data change → `node scripts/harness/check-harness.mjs` must report `harnessGaps: 0` (the runner triggers it automatically for harness paths).

**Green ≠ proof:** a green `pnpm test` is not coverage evidence for `plugin-kit`/`langfuse-plugin` (`--passWithNoTests`, no real specs) or engine's `src/orchestrator/` module (no specs yet).

## 6. Failure capture (named failure → guard)

- **Over-pruning tool-call history dropped later user turns**: any new message-history cleanup in `loop.ts` MUST ship a parallel regression test — `packages/engine/src/core/loop.test.ts` pins that later user turns survive `pruneIncompleteToolExchanges()`.
  Detail: packages/engine/harness/knowledge/loop-lifecycle.md.
- **Blocking I/O froze the Electron host**: never `execSync`/blocking I/O in `packages/engine/src/tools/*` — the engine runs on GUI main threads; confirm the actual blocking call before patching adjacent paths.
  Detail + guards: packages/engine/harness/knowledge/tools-reference.md (§Cross-Cutting).
- **UTF-8 chunk-split corruption**: async rewrite decoded each pipe chunk independently, corrupting multi-byte CJK. Guard: collect raw `Buffer`s and decode once.
- **grep shell injection + blocking I/O**: tool arguments go to async `execFile` as an array — never build a shell string; `packages/engine/src/tools/grep.test.ts` asserts an injecting pattern does not execute.
  Detail: packages/engine/harness/knowledge/tools-reference.md (grep card).
- **MCP reload stale/empty state**: reload didn't activate the target scope first. Guard: `activateScope` before reload, force fresh probe.
- **Stale doc claimed canvas-workspace excluded**: a prose workspace list (`apps/EXPERIMENTAL.md`, since deleted) contradicted `pnpm-workspace.yaml`. Guard: `pnpm-workspace.yaml` owns workspace membership; run `check-harness.mjs` to detect coverage drift; do not trust prose workspace lists.
- **Declared-but-unwired tests masked a real bug**: when bootstrapping any workspace, cross-check test files × test script before trusting "no tests here" — remote-server's six unwired Vitest suites hid a ProxyAgent cache-key bug.
  Detail: apps/remote-server/harness/knowledge/known-defects.md (§Resolved, §Test coverage reality).
- **Unbounded `capturePage` hangs on hidden webview guests**: never await Electron `capturePage` unbounded on possibly-hidden/occluded webContents — captures go through the 2s-bounded `captureBoundedSnapshot` (`apps/canvas-workspace/src/main/webview/snapshot.ts`).
  Detail + guards: apps/canvas-workspace/harness/knowledge/dock-browser.md (§Guest lifetime).
- **Parallel canvas-cli writes destroyed each other's nodes**: every CLI canvas write runs inside the workspace lock and must not full-sync-sweep per-node files; app↔CLI concurrency is NOT covered by the lock (per-node `updatedAt` arbitration only).
  Detail + guards: packages/canvas-cli/harness/knowledge/storage-concurrency.md.

- **Menu accelerators silently ate renderer shortcuts**: Electron `role` menu items win a keystroke in MAIN before any renderer listener sees it — check `menu.ts` for a role claiming the chord before adding any renderer shortcut, and never add a `role` whose accelerator collides with a registry binding.
  Detail + guards: apps/canvas-workspace/harness/knowledge/keyboard-shortcuts.md.
- **Documented-but-unimplemented shortcuts**: a UI surface must never hardcode a chord or its label — derive both from the registry; `Cmd+Shift+A` once shipped advertised-with-no-handler and silently ran select-all instead.
  Detail + guards: apps/canvas-workspace/harness/knowledge/keyboard-shortcuts.md.

Failures are captured in fix commits + regression tests — debug via `git log -- <file>` and focused tests, not by grepping for TODOs.

**Task-end write-back**: before finishing a task, route what it taught you — new fact → the nearest owning doc or workspace `AGENTS.md` — but never inline multi-sentence knowledge into a router table row or constraint bullet: put it in that workspace's `harness/knowledge/` file (create one if missing) and leave a pointer row; new check → the affected workspace's `harness/validate/validation.yaml`; a cross-module rule that cannot become a check → one line appended to this section. No separate feedback store.

## 7. Security / secrets

Do not commit API keys or tokens. Runtime keys (`OPENAI_API_KEY`/`PULSE_OPENAI_API_KEY`, `ANTHROPIC_API_KEY`/`PULSE_ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `GEMINI_API_KEY`, `INTERNAL_API_SECRET`, `CLARIFICATION_*`) are env-only. Default model precedence (code at `packages/engine/src/config/index.ts`): `ANTHROPIC_MODEL` → `OPENAI_MODEL` → `PULSE_ANTHROPIC_MODEL` → `PULSE_OPENAI_MODEL` → `novita/deepseek/deepseek_v3`. `PULSE_`-prefixed fallbacks exist for every provider var. Remote-server internal routes are loopback-only and require `INTERNAL_API_SECRET`. Plugin secret storage uses the vault helpers in `pulse-coder-plugin-kit`.

## 8. `.pulse-coder/` vs `.coder/`

`.pulse-coder/` is the active runtime/product config root. On disk it holds `mcp.json` (3 servers: `eido_mind`, `deepwiki`, `twitter` — all `deferTools:true`), `agents/` (8 sub-agents), `skills/` (10 runtime knowledge skills). `config.json`, `engine-plugins/`, and `skills/remote.json` are ABSENT on disk but their loaders are wired in source. Legacy `.coder/*` paths remain compatible in the MCP/skills/sub-agent/engine-plugins loaders but are not preferred — write new config under `.pulse-coder/`. Runtime skills (`.pulse-coder/skills`) are not repo harness protocols.
