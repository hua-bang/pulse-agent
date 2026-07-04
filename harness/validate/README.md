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
| Honest gap: no runner, no CI, no git hooks | Root `AGENTS.md` §4 ("Gap to close") + `harness/ROADMAP.md` |
| Candidate mechanical checks | Future checks protocol once the rules are stable enough to mechanize |
| Keystone gap: turn `validation.yaml` into a runnable mechanism | `harness/ROADMAP.md` |

## Honest reality

Validation YAML files are declarative. Nothing runs them today — there is no CI, no git hooks, no husky/lint-staged, and no executable harness checks yet. Validation is currently carried by agent discipline plus manual `pnpm --filter` runs. State this honestly; do not claim a gate exists when it does not.

Known red command — do not promote: `pnpm run test:apps` can exit 1 because `apps/coder-demo`'s test script is `echo Error && exit 1`. Use targeted `pnpm --filter <pkg> test` and do not treat a bare `test:apps` failure as a regression unless excluded apps are filtered out.

## What does not belong here

- Stable enforceable checks once implemented: protocol should live with the future checks surface, implementation in `scripts/harness/`.
- Workspace-specific validation details: keep in workspace `harness/validate/`.

## When to add files

Keep workspace `harness/validate/validation.yaml` files focused on local default checks. Keep root `harness/validate/validation.yaml` for global config changes and cross-workspace impact rules.

Run evidence does not live in YAML. Put it in the final response, PR/MR description, or CI logs when CI exists.
