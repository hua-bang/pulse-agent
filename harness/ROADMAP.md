# Harness Roadmap

> Status of the repository-level harness pilot, and what remains. This doc talks about the harness itself; for product/runtime behavior see workspace `AGENTS.md` and `docs/`.

## Where we are

The harness pilot has a real, populated foundation:

- `pnpm-workspace.yaml` defines the active workspace set; workspace `AGENTS.md` files own local role, navigation, and knowledge pointers.
- Every active workspace has a local `harness/validate/validation.yaml` for package-local default checks.
- `harness/validate/validation.yaml` maps root config checks and cross-workspace impact escalation rules.
- `harness/tools/graph-viewer/server.mjs` is the one wired executable — a drift detector (`--once` smoke check, reports `harnessGaps`).
- Root `AGENTS.md` carries the meta-rules layer (precedence + SSOT-no-copies + mechanism-over-doc + first-principles + Occam + 5-step self-check), the L0/L1/L2 doc taxonomy, the intent navigation table, hard boundaries with honest test-reality, workspace-local validation routing, and named failure-capture with guards.

What is **honestly absent**: apart from `.github/workflows/perf.yml` (canvas-workspace perf gates), there is NO CI for tests/typecheck, NO git hooks, NO husky/lint-staged/commitlint, and NO executable harness checks yet. Validation YAML files are declarative — nothing runs them. `graph-viewer` is the only wired harness tool. `harness/skills/`, `harness/feedback/`, `harness/templates/`, `harness/checks/`, and `scripts/harness/` do not exist today.

## The keystone gap: turn the declarative SSOT into a runnable mechanism

Every constraint in this harness is currently carried by agent discipline. The single highest-value next step is to give the existing SSOT an executor.

**Goal:** `scripts/harness/run-harness-check.mjs` — a runner that reads workspace-local `harness/validate/validation.yaml` files plus the root overlay and executes the check(s) bound to a changed path (or `--all`).

**Why this is the keystone:**
- It converts "honesty-about-absence" into "honesty-with-a-mechanism" (the root `AGENTS.md` §4 already admits the gap; this closes it).
- It plays to an existing strength: validation YAML is already a path→check SSOT. The missing layer is the runner, not the data.
- It is the one move that closes the largest lead the reference sample (B) has — mechanical enforcement — without copying B's domain-specifics.

**Phased rollout (mechanism matures only after the rule proves stable — per `harness/README.md` principles):**

1. **Manual runner first.** `node scripts/harness/run-harness-check.mjs [--path <glob>|--all]`. Reads local and root validation YAML, runs the bound `pnpm --filter` commands, prints a pass/fail report. No git integration yet. This alone makes validation executable and lets agents/humans verify changes without remembering the matrix.
2. **Wire candidate checks** such as `workspace-coverage`, `agents-coverage`, `routing-links`, and `validation-matrix`. Each becomes a function the runner can invoke once the rules are stable, implementation in `scripts/harness/`.
3. **Optional pre-push hook.** Only after step 1–2 are stable in manual use, add an opt-in `scripts/harness/pre-push.mjs` that runs affected-workspace checks on `git push`. Do not make it mandatory until the false-positive rate is near zero.
4. **Optional CI.** Only if/when a CI provider is chosen for this repo. Until then the manual runner is the source of truth.

**Non-goals for this phase:** full CI pipeline, lint/format enforcement (eslint/prettier are absent repo-wide and out of scope here), Node version pinning (separate concern).

## Other open items (breadth, lower priority than the keystone)

- **Repo action protocols.** `harness/skills/` does not exist today. Add it only when a recurring workflow is stable enough to justify a protocol file.
- **Candidate harness tools.** `harness/tools/README.md` lists tool ideas, but only `graph-viewer` exists. Implement candidates only when they become useful enough to run.

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
- Knowledge/Validate surface alignment with the finalized `Harness = AGENTS.md + Knowledge + Tool + Validate + Skills` model: elevated Skills to an explicit fourth surface, renamed Know -> Knowledge, renamed Verify -> Validate, and added `harness/knowledge/README.md` + `harness/validate/README.md` as routing indexes.
