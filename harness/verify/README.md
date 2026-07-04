# Harness Verify

`harness/verify` is the index for the **Verify** surface: how the agent proves the result — validation matrix, quality gates, known gaps, and delivery evidence.

This directory is an index, not a copy. Verify in this repo is distributed across SSOTs that already exist. Read this README to find where to look; do not duplicate validation rules here.

## Mapping

| Verify | Default SSOT |
|---|---|
| Path → check matrix (the core Verify SSOT) | `harness/validation.yaml` |
| Acceptance standards, reproducible commands | Root `AGENTS.md` §5 |
| Named failure captures and their guards | Root `AGENTS.md` §6 |
| Honest gap: no runner, no CI, no git hooks | Root `AGENTS.md` §4 ("Gap to close") + `harness/ROADMAP.md` |
| Candidate mechanical checks (placeholder) | `harness/checks/README.md` |
| Keystone gap: turn `validation.yaml` into a runnable mechanism | `harness/ROADMAP.md` |
| Workspace-local validation | Workspace `docs/validation.md` where present |

## Honest reality

`harness/validation.yaml` is a declarative path → check SSOT. Nothing runs it today — there is no CI, no git hooks, no husky/lint-staged, and no executable under `harness/checks/` (placeholder only). Validation is currently carried by agent discipline plus manual `pnpm --filter` runs. State this honestly; do not claim a gate exists when it does not.

Known red command — do not promote: `pnpm run test:apps` can exit 1 because `apps/coder-demo`'s test script is `echo Error && exit 1`. Use targeted `pnpm --filter <pkg> test` and do not treat a bare `test:apps` failure as a regression unless excluded apps are filtered out.

## What does not belong here

- Stable enforceable checks once implemented: protocol stays in `harness/checks/README.md`, implementation in `scripts/harness/`.
- Feedback on validation gaps: route to `harness/feedback/` first.
- Workspace-specific validation details: keep in workspace `docs/validation.md`.

## When to add a file under `harness/verify/`

Add a dedicated Verify file only when a validation rule or known-gap set no longer fits an existing SSOT (e.g. a cross-workspace `known-gaps.md` once the gap list outgrows `harness/ROADMAP.md`). The first move is always to extend `harness/validation.yaml` or the relevant workspace `docs/validation.md`; split a file out only when the matrix becomes too dense.