---
name: code-review
description: Review changes with repository-aware context, affected workspace routing, and validation expectations.
---

# Code Review Skill

## Trigger

Use this when reviewing a diff, PR, MR, or local change set.

## Boundary

Review prioritizes correctness, regressions, security, contract drift, validation gaps, and maintainability risks. It does not apply fixes unless explicitly requested in a separate implementation task.

## Steps

1. Identify changed files and affected workspaces.
2. Read root routing only as needed: `AGENTS.md`, `harness/profile.yaml`, `harness/validation.yaml`.
3. Read the nearest workspace entry and contract/spec/runbook for changed areas.
4. Review for:
   - correctness and edge cases
   - public contract drift
   - plugin/tool/runtime boundary violations
   - security and secret handling
   - validation evidence gaps
5. Keep findings specific and tied to files/lines.

## Output

- Must-fix findings first.
- Suggestions second.
- Validation gaps and residual risk.
- No issue statement when no high-confidence bug is found.

## Validation

Recommended checks should match `harness/validation.yaml` and workspace `docs/validation.md`.
