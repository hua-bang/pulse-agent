# Harness Validate

`harness/validate` is the index for the **Validate** surface: how the agent decides what to run, where local validation lives, and how validation evidence is reported.

This directory is an index plus optional root impact rules. Package-level validation remains the primary source of local detail.

## Mapping

| Validate | Default SSOT |
|---|---|
| Root validation routing and cross-workspace impact | `harness/validate/validation.yaml` |
| Workspace-local validation | Workspace `harness/validate/validation.yaml` |
| Acceptance standards, reproducible commands | Root `AGENTS.md` §5 |
| Named failure captures and their guards | Root `AGENTS.md` §6 |
| Manual runner | `scripts/harness/run-harness-check.mjs` |
| Honest gap: no automatic trigger (CI/hooks), no semantic contradiction/test-effectiveness checks | Root `AGENTS.md` §4 ("Gap to close") + `harness/ROADMAP.md` |
| Structural mechanical checks | `scripts/harness/check-harness.mjs` |
| Runner phases remaining (opt-in pre-push, CI) | `harness/ROADMAP.md` |

## Honest reality

Validation YAML files are executed by the manual runner `node scripts/harness/run-harness-check.mjs` (changed paths by default; `--since`, `--path`, `--all`). Nothing triggers it automatically — apart from `.github/workflows/perf.yml` (canvas-workspace perf gates), there is no CI for tests/typecheck, no git hooks, and no husky/lint-staged. Running the checks is still a discipline; only the lookup and execution are mechanized. State this honestly; do not claim an automatic gate exists when it does not.

Known red command — do not promote: `pnpm run test:apps` can exit 1 because `apps/coder-demo`'s test script is `echo Error && exit 1`. Use targeted `pnpm --filter <pkg> test` and do not treat a bare `test:apps` failure as a regression unless excluded apps are filtered out.

## What does not belong here

- Stable enforceable checks once implemented: protocol should live with the future checks surface, implementation in `scripts/harness/`.
- Workspace-specific validation details: keep in workspace `harness/validate/`.

## When to add files

Keep workspace `harness/validate/validation.yaml` files focused on local default checks. Keep root `harness/validate/validation.yaml` for global config changes and cross-workspace impact rules.

Run evidence does not live in YAML. Put it in the final response, PR/MR description, or CI logs when CI exists.
