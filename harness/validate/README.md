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
| Honest gap: no automatic general validation trigger or semantic/test-effectiveness checks | This document + `harness/ROADMAP.md` |
| Structural mechanical checks | `scripts/harness/check-harness.mjs` |
| Further automation (opt-in pre-push, broad application CI) | `harness/ROADMAP.md` |

## Honest reality

Validation YAML files are executed by `node scripts/harness/run-harness-check.mjs` (changed paths by default; --since, --path, --all). Performance CI owns Canvas performance/package gates. The harness-integrity workflow owns structural checks, focused harness/policy tests, and an all-rules dry-run plan. It does not execute ordinary workspace acceptance commands; those remain manual. There are no pre-push hooks or husky/lint-staged.

## Operating the Checks

Run from the repository root. The runner reads the changed paths from git status by default; use --path for a scoped file/directory set, --since for committed changes relative to a ref, and --dry-run to inspect the plan. Root path rules are an overlay on all changed paths. Cross-package escalation commands are reminders and must be run manually when the contract change qualifies.

| Work | Evidence |
|---|---|
| Iteration | quick (the default); legacy untiered rules keep their original commands |
| Functionally complete change | standard; local validation plus applicable root impact checks |
| Performance/release-sensitive work | release plus the relevant live/manual scenario |
| Explicit full local sweep | pnpm run build, then pnpm run test:core; include Canvas explicitly when affected |
| Full bound-check sweep | --all defaults to release; it is not routine acceptance for a local edit |
| Harness data edit | check-harness must report harnessGaps: 0 |

Root build/test aliases target core packages and remote-server. Canvas is included by build:all/test:all but excluded from build:core/test:core. Root build supplies SKIP_DTS=1; whether that disables declarations depends on the owning package's build script/config. Vitest is the common JS/TS test runner; Canvas has its own vitest.config.ts, and CLI Harbor validation also uses Python. Read package-local validation for missing scripts, declaration-build limitations, and untested modules.

The Canvas performance workflow selects bundle/runtime/macOS package checks by impact, performance label, dispatch, or default-branch changes. The harness-integrity workflow additionally checks configuration and focused tool/policy regressions, with native install scripts disabled. Normal application tests/typecheck still require manual acceptance. Structural checks do not detect all semantic contradictions or prove test effectiveness; further automatic enforcement requires its own false-positive qualification.

Report executed commands, results, and manual/unverified scope in the response or PR. A planned command, passing structural scan, or green suite outside the affected module is not acceptance evidence for that module. When wiring a workspace, cross-check test files against its test script: remote-server's formerly unwired Vitest suites concealed a real ProxyAgent defect (detail: apps/remote-server/harness/knowledge/known-defects.md).

## Evidence Reports

Use --report .harness/validation.json to save a versioned JSON report; that root artifact directory is ignored by Git. Relative output paths resolve from repository root. The writer resolves directory aliases before protecting tracked files and Git metadata, refuses final-component symlinks and non-report content, and writes atomically to the verified destination. It replaces prior success with planned/running evidence before executing checks. Do not use a saved report as cached proof for a later change.

The report records source mode/ref, HEAD, dirty-worktree status, selected level, affected paths/workspaces, command selection reasons, exit codes/durations, uninspected references, unmatched paths, and manual/escalation work. HEAD plus dirty status does not identify immutable uncommitted contents.

| State | Meaning |
|---|---|
| planned | Selected but not executed, including dry-run output |
| running | Execution began; no final acceptance result is available yet |
| passed / failed | Result of the selected automatic checks, not full human acceptance |
| no-checks | Explicitly identified document/auxiliary scope has no executable checks |
| deferred-by-level | A rule matched but its commands belong to a higher level |
| manual / escalation not-run | Additional evidence remains outstanding |

Exit 2 means invalid input/configuration, invalid command references, or unbound managed source/build/test configuration. Exit 1 means an executed check failed. Exit 0 covers successful selected checks and explicitly labelled no-checks/deferred outcomes; inspect the status and outstanding work before declaring acceptance. Invalid CLI arguments or unsafe report destinations fail before a report is created.

## What does not belong here

- Stable enforceable checks once implemented: protocol should live with the future checks surface, implementation in `scripts/harness/`.
- Workspace-specific validation details: keep in workspace `harness/validate/`.

## When to add files

Keep workspace `harness/validate/validation.yaml` files focused on local default checks. Keep root `harness/validate/validation.yaml` for global config changes and cross-workspace impact rules.

Run evidence does not live in YAML. Put it in the final response, PR/MR description, or CI logs when CI exists.
