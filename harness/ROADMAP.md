# Harness Roadmap

> Status of the repository-level harness pilot, and what remains. This doc talks about the harness itself; for product/runtime behavior see workspace `AGENTS.md` and `docs/`.

## Where we are

The harness pilot has a real, populated foundation:

- `pnpm-workspace.yaml` defines the active workspace set; workspace `AGENTS.md` files own local role, navigation, and knowledge pointers.
- Every active workspace has a local `harness/validate/validation.yaml` for package-local default checks.
- `harness/validate/validation.yaml` maps root config checks and cross-workspace impact escalation rules.
- `scripts/harness/check-harness.mjs` is the drift check (reports `harnessGaps`; successor to the retired graph-viewer dashboard — the UI was early over-build, only the check was load-bearing).
- `scripts/harness/run-harness-check.mjs` is the validation runner (keystone phase 1, landed 2026-07-07): resolves changed paths (or `--since <ref>` / `--path` / `--all`) to the bound workspace-local + root-overlay commands and executes them with a pass/fail report; escalation rules are printed as reminders, never auto-run.
- Root `AGENTS.md` carries the meta-rules layer (precedence + SSOT-no-copies + mechanism-over-doc + first-principles + Occam + 5-step self-check), the L0/L1/L2 doc taxonomy, the intent navigation table, hard boundaries with honest test-reality, workspace-local validation routing, and named failure-capture with guards.

What is **honestly absent**: apart from `.github/workflows/perf.yml` (canvas-workspace perf gates), there is NO CI for tests/typecheck, NO git hooks, NO husky/lint-staged/commitlint, and NO automatic trigger for the runner — invoking it is still discipline. Candidate mechanical checks (`workspace-coverage`, `routing-links`, …) are not implemented. `harness/skills/`, `harness/feedback/`, `harness/templates/`, and `harness/checks/` do not exist today.

## The keystone: turn the declarative SSOT into a runnable mechanism (phase 1 DONE)

Every constraint in this harness is currently carried by agent discipline. The single highest-value next step is to give the existing SSOT an executor.

**Goal:** `scripts/harness/run-harness-check.mjs` — a runner that reads workspace-local `harness/validate/validation.yaml` files plus the root overlay and executes the check(s) bound to a changed path (or `--all`).

**Why this is the keystone:**
- It converts "honesty-about-absence" into "honesty-with-a-mechanism" (the root `AGENTS.md` §4 already admits the gap; this closes it).
- It plays to an existing strength: validation YAML is already a path→check SSOT. The missing layer is the runner, not the data.
- It is the one move that closes the largest lead the reference sample (B) has — mechanical enforcement — without copying B's domain-specifics.

**Phased rollout (mechanism matures only after the rule proves stable — per `harness/README.md` principles):**

1. **Manual runner first.** ✅ DONE (2026-07-07, `scripts/harness/run-harness-check.mjs`).
   Original goal: `node scripts/harness/run-harness-check.mjs [--path <glob>|--all]`. Reads local and root validation YAML, runs the bound `pnpm --filter` commands, prints a pass/fail report. No git integration yet. This alone makes validation executable and lets agents/humans verify changes without remembering the matrix.
2. **Wire candidate checks.** ✅ DONE (2026-07-07): `check-harness.mjs` covers `workspace-coverage`, `agents-coverage`, `validation-matrix`, and `routing-links` (doc path liveness with absence-signal skipping — honest-absence lists, conditional/future references, and runtime-artifact mentions are not flagged). The runner invokes it via the root `harness-data` path rule.
3. **Optional pre-push hook.** Only after step 1–2 are stable in manual use, add an opt-in `scripts/harness/pre-push.mjs` that runs affected-workspace checks on `git push`. Do not make it mandatory until the false-positive rate is near zero.
4. **Optional CI.** Only if/when a CI provider is chosen for this repo. Until then the manual runner is the source of truth.

**Non-goals for this phase:** full CI pipeline, lint/format enforcement (eslint/prettier are absent repo-wide and out of scope here), Node version pinning (separate concern).

## Other open items (breadth, lower priority than the keystone)

- **Repo action protocols.** Root `harness/skills/` does not exist today (add only when a recurring workflow is stable enough). Note: the first WORKSPACE-local surfaces now exist — `packages/engine/harness/tools/describe-engine.mjs` (structure snapshot) and `packages/engine/harness/skills/add-builtin-plugin.md` (safe-change procedure) — covering engine's orient/iterate needs that the repo runner does not.
- **Candidate harness tools.** `harness/tools/README.md` lists remaining tool ideas (repo-profiler, ssot-resolver, feedback-router). Implement candidates only when they become useful enough to run.

## Deliberately deferred (not gaps — out of scope for this repo)

The comparison against the reference sample (B / `ec_channel_lynx_x`) surfaced items that are correct for B's context but wrong here. These are NOT on the roadmap unless the repo's context changes:

- Pinned Node version (B pins v22 LTS). Coder is currently unpinned; add a pin only if CI or runtime breakage forces it.
- Spec-Driven confirmation gate, JSDoc mandate, OWNERS ≥2, 3x asset rule, Chinese-comment norm, emo/Eden toolchain. These are team/domain-specifics, not universal harness elements.

## Done log

- Meta-rules layer with precedence + SSOT-no-copies + mechanism-over-doc + first-principles + Occam + 5-step self-check (root `AGENTS.md` §0).
- L0/L1/L2 doc taxonomy (root `AGENTS.md` §1).
- Intent navigation table (root `AGENTS.md` §1).
- Two-tier skill taxonomy + action→required-read table (root `AGENTS.md` §4).
- Honest test-reality in hard boundaries (root `AGENTS.md` §2).
- Named failure-capture with guards (root `AGENTS.md` §6).
- Workspace-local `harness/validate/validation.yaml` files cover package-local default checks; root `harness/validate/validation.yaml` is now the root/cross-workspace overlay.
- First full-sweep run exposed that root `pnpm test` had been structurally red since v1 (`plugin-kit`/`langfuse-plugin`: `vitest run` with zero test files exits 1); fixed with `--passWithNoTests`. Lesson: a required command nobody has ever executed can be broken from day one — run the sweep once before binding it.
- Root script aliases: `pnpm run harness` (runner) and `pnpm run harness:drift` (drift check).
- Keystone phase 1: manual validation runner `scripts/harness/run-harness-check.mjs` (git-status/`--since`/`--path`/`--all` modes, dry-run, escalation reminders; verified against the remote-server change replay and a full `--all --dry-run` plan).
- Knowledge/Validate surface alignment with the finalized `Harness = AGENTS.md + Knowledge + Tool + Validate + Skills` model: elevated Skills to an explicit fourth surface, renamed Know -> Knowledge, renamed Verify -> Validate, and added `harness/knowledge/README.md` + `harness/validate/README.md` as routing indexes.
