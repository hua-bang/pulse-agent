# Harness Roadmap

> Status of the repository-level harness pilot, and what remains. This doc talks about the harness itself; for product/runtime behavior see workspace `AGENTS.md` and `docs/`.

## Where we are

The harness pilot has a real, populated foundation:

- `harness/profile.yaml` routes 14 active workspaces (type / packageName / role / entry / knowledge).
- `harness/validation.yaml` maps 15 `pathRules` + 4 `escalationRules` + fallback to concrete `pnpm --filter` commands — a path-keyed SSOT.
- `harness/skills/*.md` (5) define repo action protocols (code-review, contract-coding, doc-governance, feedback-governance, quality-workflow).
- `harness/tools/graph-viewer/server.mjs` is the one wired executable — a drift detector (`--once` smoke check, reports `harnessGaps`).
- Root `AGENTS.md` carries the meta-rules layer (precedence + SSOT-no-copies + mechanism-over-doc + first-principles + Occam + 5-step self-check), the L0/L1/L2 doc taxonomy, the intent navigation table, hard boundaries with honest test-reality, a two-tier skill taxonomy with action→required-read table, and named failure-capture with guards.

What is **honestly absent**: there is NO CI, NO git hooks, NO husky/lint-staged/commitlint, and NO executable checks under `harness/checks/` (placeholder only). `harness/validation.yaml` is declarative — nothing runs it. `harness/tools/*` (except `graph-viewer`) are spec-only READMEs. `scripts/harness/` does not exist.

## The keystone gap: turn the declarative SSOT into a runnable mechanism

Every constraint in this harness is currently carried by agent discipline. The single highest-value next step is to give the existing SSOT an executor.

**Goal:** `scripts/harness/run-harness-check.mjs` — a runner that reads `harness/validation.yaml` and executes the check(s) bound to a changed path (or `--all`).

**Why this is the keystone:**
- It converts "honesty-about-absence" into "honesty-with-a-mechanism" (the root `AGENTS.md` §4 already admits the gap; this closes it).
- It plays to an existing strength: `validation.yaml` is already a path→check SSOT. A is missing only the runner, not the data.
- It is the one move that closes the largest lead the reference sample (B) has — mechanical enforcement — without copying B's domain-specifics.

**Phased rollout (mechanism matures only after the rule proves stable — per `harness/README.md` principles):**

1. **Manual runner first.** `node scripts/harness/run-harness-check.mjs [--path <glob>|--all]`. Reads `validation.yaml`, runs the bound `pnpm --filter` commands, prints a pass/fail report. No git integration yet. This alone makes `validation.yaml` executable and lets agents/humans verify changes without remembering the matrix.
2. **Wire the candidate checks** listed in `harness/checks/README.md` (`profile-coverage`, `agents-coverage`, `routing-links`, `skill-frontmatter`, `validation-matrix`). Each becomes a function the runner can invoke; protocol stays in `harness/checks/README.md`, implementation in `scripts/harness/`.
3. **Optional pre-push hook.** Only after step 1–2 are stable in manual use, add an opt-in `scripts/harness/pre-push.mjs` that runs affected-workspace checks on `git push`. Do not make it mandatory until the false-positive rate is near zero.
4. **Optional CI.** Only if/when a CI provider is chosen for this repo. Until then the manual runner is the source of truth.

**Non-goals for this phase:** full CI pipeline, lint/format enforcement (eslint/prettier are absent repo-wide and out of scope here), Node version pinning (separate concern).

## Other open items (breadth, lower priority than the keystone)

- **Skill governance meta-skill.** `harness/skills/` has no governance protocol for adding/renaming/retiring its own skills (the reference sample has one). Defer until the runner lands and skill churn justifies it.
- **`harness/tools/*` execution.** Five of six tool subdirs are spec-only READMEs. Either implement them or mark them explicitly as deferred specs in their READMEs so readers do not expect executables.
- **`harness/templates/*` usage.** Only `feedback-proposal.md` is referenced anywhere. Either wire the other three (workspace-agents, package-contract, app-spec-overview) into the skills that should use them, or remove them.
- **`harness/feedback/inbox.md`** is an empty template. Leave as-is until real feedback arrives; do not pre-fill.

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
- `harness/validation.yaml` and `harness/profile.yaml` already SSOT-complete.
