---
name: validate-canvas-change
description: Select and run proportionate validation for changes to apps/canvas-workspace. Use when iterating on Canvas Workspace code, finishing a feature or fix, preparing release evidence, or deciding whether a full performance report is necessary.
---

# Validate a Canvas Change

Use `apps/canvas-workspace/harness/validate/validation.yaml` as the command
source of truth. Run from the repository root.

## Choose the Level

- During iteration, run `pnpm run harness` (default `quick`). Keep feedback
  fast and do not run the full performance report.
- When the change is functionally complete, run
  `pnpm run harness -- --level standard`.
- Run `pnpm run harness -- --level release` only for a performance-focused
  task, a performance-sensitive change, or release evidence.
- Do not use `--all` as routine acceptance for a local change. It intentionally
  selects `release` and performs a repository-wide sweep.

Treat changes to performance policies or collectors, Electron/Vite build and
packaging configuration, startup/bootstrap paths, and hot renderer interaction
paths as performance-sensitive. For an ordinary localized UI or logic change,
`standard` is the completion level unless the user explicitly requests
performance evidence.

Report the commands actually run and any release-only or manual checks skipped.
